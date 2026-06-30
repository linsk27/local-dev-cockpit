import type { IncomingMessage, ServerResponse } from "node:http";
import { z } from "zod";
import { commandStartBlockReason, commandSystemPortBlockReason } from "../services/command-guards.js";
import { createProjectContextPayload, writeProjectContextFiles } from "../services/context-files.js";
import { invalidateExternalPortOwnersCache } from "../services/port-status.js";
import { loadProject, loadProjects } from "../services/project-service.js";
import { projectPortCanBeStopped, stopPort } from "../services/port-control.js";
import { openProjectFolder, openProjectInEditor } from "../services/native-shell.js";
import {
  diagnoseCommandEnvironment,
  discoverPythonEnvironmentCandidates,
  validatePythonEnvironmentBinding
} from "../process-manager.js";
import { projectEnvironmentForPath } from "../store.js";
import { readJson, sendJson } from "./shared.js";
import type { ServerRouteContext } from "./types.js";

const updateProjectEnvironmentSchema = z.object({ python: z.string().max(500).default("") });

export async function handleProjectRoute(
  method: string,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
  context: ServerRouteContext
): Promise<boolean> {
  if (method === "GET" && url.pathname === "/api/projects") {
    const force = url.searchParams.get("force") === "1";
    const scopeKey = url.searchParams.get("rootId") || "all";
    const projects = await context.projectCache.get(scopeKey, force, () => loadProjects(context.store, context.processManager, url.searchParams.get("rootId")));
    sendJson(res, 200, { projects });
    return true;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === "GET" && projectMatch) {
    const project = await loadProject(projectMatch[1] ?? "", context.store, context.processManager);
    sendJson(res, 200, { project });
    return true;
  }

  const openProjectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/open-folder$/);
  if (method === "POST" && openProjectMatch) {
    const project = await loadProject(openProjectMatch[1] ?? "", context.store, context.processManager);
    const result = await openProjectFolder(project.path);
    sendJson(res, 200, result);
    return true;
  }

  const openEditorMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/open-editor$/);
  if (method === "POST" && openEditorMatch) {
    const project = await loadProject(openEditorMatch[1] ?? "", context.store, context.processManager);
    const config = await context.store.readConfig();
    const result = await openProjectInEditor(project.path, config.editorCommand);
    sendJson(res, 200, result);
    return true;
  }

  const startMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/commands\/([^/]+)\/start$/);
  if (method === "POST" && startMatch) {
    const project = await loadProject(startMatch[1] ?? "", context.store, context.processManager);
    const command = project.commands.find((item) => item.id === decodeURIComponent(startMatch[2] ?? ""));
    if (!command) {
      sendJson(res, 404, { error: "Command not found" });
      return true;
    }
    const blockReason = commandStartBlockReason(project, command);
    if (blockReason) {
      sendJson(res, 409, { error: blockReason });
      return true;
    }
    const systemPortBlockReason = await commandSystemPortBlockReason(command);
    if (systemPortBlockReason) {
      sendJson(res, 409, { error: systemPortBlockReason });
      return true;
    }
    const config = await context.store.readConfig();
    const environmentDiagnostic = await diagnoseCommandEnvironment(command, {
      projectEnvironment: projectEnvironmentForPath(config, command.cwd)
    });
    if (environmentDiagnostic.status === "missing") {
      sendJson(res, 409, {
        error: `${environmentDiagnostic.summary} ${environmentDiagnostic.detail}`.trim(),
        diagnostic: environmentDiagnostic
      });
      return true;
    }
    const run = await context.processManager.start(project.id, command);
    invalidateExternalPortOwnersCache();
    context.projectCache.invalidate();
    sendJson(res, 200, { run });
    return true;
  }

  const stopMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/processes\/([^/]+)\/stop$/);
  if (method === "POST" && stopMatch) {
    const projectId = decodeURIComponent(stopMatch[1] ?? "");
    const runId = decodeURIComponent(stopMatch[2] ?? "");
    const stoppedRun = await context.processManager.stop(runId);
    if (stoppedRun) {
      invalidateExternalPortOwnersCache();
      context.projectCache.invalidate();
      sendJson(res, 200, { stopped: true, run: stoppedRun });
      return true;
    }
    const staleRun = await context.store.markRunStopped(projectId, runId);
    invalidateExternalPortOwnersCache();
    context.projectCache.invalidate();
    sendJson(res, 200, { stopped: false, run: staleRun });
    return true;
  }

  const stopPortMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/ports\/(\d+)\/stop$/);
  if (method === "POST" && stopPortMatch) {
    const projectId = decodeURIComponent(stopPortMatch[1] ?? "");
    const port = Number(stopPortMatch[2]);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      sendJson(res, 400, { stopped: false, port, pids: [], error: "Invalid port" });
      return true;
    }
    const project = await loadProject(projectId, context.store, context.processManager);
    if (!projectPortCanBeStopped(project, port)) {
      sendJson(res, 200, {
        stopped: false,
        port,
        pids: [],
        error: "该端口不是 Dev Cockpit 托管进程，也不是当前项目的可操作端口。请在启动它的终端或系统任务管理器中停止。"
      });
      return true;
    }
    const result = await stopPort(port);
    if (result.stopped) {
      const state = await context.store.readState();
      const run = state.runs[projectId];
      if (run) await context.store.markRunStopped(projectId, run.id);
      await context.store.clearError(projectId);
    }
    invalidateExternalPortOwnersCache();
    context.projectCache.invalidate();
    sendJson(res, 200, result);
    return true;
  }

  const logMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/logs$/);
  if (method === "GET" && logMatch) {
    const runId = url.searchParams.get("runId") ?? "";
    const logs = runId ? await context.processManager.readLogs(runId) : "";
    sendJson(res, 200, { logs });
    return true;
  }

  const contextMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/context$/);
  if (method === "GET" && contextMatch) {
    const project = await loadProject(contextMatch[1] ?? "", context.store, context.processManager);
    sendJson(res, 200, createProjectContextPayload(project));
    return true;
  }

  const environmentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/environment$/);
  if (method === "GET" && environmentMatch) {
    const project = await loadProject(environmentMatch[1] ?? "", context.store, context.processManager);
    const config = await context.store.readConfig();
    const diagnostics = await Promise.all(
      project.commands.map((command) =>
        diagnoseCommandEnvironment(command, { projectEnvironment: projectEnvironmentForPath(config, command.cwd) })
      )
    );
    sendJson(res, 200, { diagnostics });
    return true;
  }

  const environmentCandidatesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/environment\/candidates$/);
  if (method === "GET" && environmentCandidatesMatch) {
    const project = await loadProject(environmentCandidatesMatch[1] ?? "", context.store, context.processManager);
    const candidates = await discoverPythonEnvironmentCandidates(project.path);
    sendJson(res, 200, { candidates });
    return true;
  }

  const projectEnvironmentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/settings$/);
  if (projectEnvironmentMatch) {
    const project = await loadProject(projectEnvironmentMatch[1] ?? "", context.store, context.processManager);
    if (method === "GET") {
      const config = await context.store.readConfig();
      sendJson(res, 200, { environment: projectEnvironmentForPath(config, project.path) ?? { python: "" } });
      return true;
    }
    if (method === "PATCH") {
      const body = updateProjectEnvironmentSchema.parse(await readJson(req));
      try {
        await validatePythonEnvironmentBinding(project.path, body.python);
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return true;
      }
      const config = await context.store.updateProjectEnvironment(project.path, body.python);
      context.projectCache.invalidate();
      sendJson(res, 200, { environment: projectEnvironmentForPath(config, project.path) ?? { python: "" } });
      return true;
    }
  }

  const contextWriteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/context\/write$/);
  if (method === "POST" && contextWriteMatch) {
    const project = await loadProject(contextWriteMatch[1] ?? "", context.store, context.processManager);
    const result = await writeProjectContextFiles(project);
    sendJson(res, 200, result);
    return true;
  }

  return false;
}
