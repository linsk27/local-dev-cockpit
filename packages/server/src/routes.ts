import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import { z } from "zod";
import {
  diagnoseCommandEnvironment,
  discoverPythonEnvironmentCandidates,
  type ProcessManager,
  validatePythonEnvironmentBinding
} from "./process-manager.js";
import { commandStartBlockReason } from "./services/command-guards.js";
import { createProjectContextPayload, writeProjectContextFiles } from "./services/context-files.js";
import { EXTERNAL_PORT_OWNER_CACHE_TTL_MS, invalidateExternalPortOwnersCache } from "./services/port-status.js";
import { PROJECT_SCAN_CACHE_TTL_MS, type ProjectScanCache } from "./services/project-scan-cache.js";
import { loadProject, loadProjects } from "./services/project-service.js";
import { stopPort } from "./services/port-control.js";
import { checkForUpdates } from "./services/update-checker.js";
import { chooseProjectRootFolder, openProjectFolder, openProjectInEditor } from "./services/native-shell.js";
import {
  addApiLensTarget,
  ApiLensRecorder,
  createApiLensContext,
  createApiLensTarget,
  handleApiLensProxy,
  removeApiLensTarget
} from "./services/api-lens/index.js";
import { type JsonStore, projectEnvironmentForPath, rootId } from "./store.js";

const addRootSchema = z.object({ path: z.string().min(1) });
const openFolderDialogSchema = z.object({ initialPath: z.string().max(500).optional().default("") });
const updateConfigSchema = z.object({ editorCommand: z.string().min(1).max(260).optional() });
const updateProjectEnvironmentSchema = z.object({ python: z.string().max(500).default("") });
const createApiLensTargetSchema = z.object({
  name: z.string().max(80).default(""),
  baseUrl: z.string().min(1).max(500),
  projectId: z.string().max(500).optional()
});
const startedAt = Date.now();
let cpuSample = { at: startedAt, usage: process.cpuUsage() };

export interface ServerRouteContext {
  store: JsonStore;
  processManager: ProcessManager;
  projectCache: ProjectScanCache;
  apiLensRecorder: ApiLensRecorder;
  currentVersion: string;
}

export async function handleApiRoute(req: IncomingMessage, res: ServerResponse, context: ServerRouteContext): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, name: "Dev Cockpit", version: context.currentVersion });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/update") {
    sendJson(res, 200, await checkForUpdates(context.currentVersion));
    return true;
  }

  if (method === "GET" && url.pathname === "/api/performance") {
    const scopeKey = url.searchParams.get("rootId") || "all";
    sendJson(res, 200, {
      process: readProcessMetrics(),
      scan: context.projectCache.snapshot(scopeKey),
      polling: {
        projectScanCacheTtlMs: PROJECT_SCAN_CACHE_TTL_MS,
        externalPortOwnerCacheTtlMs: EXTERNAL_PORT_OWNER_CACHE_TTL_MS
      }
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/projects") {
    const force = url.searchParams.get("force") === "1";
    const scopeKey = url.searchParams.get("rootId") || "all";
    const projects = await context.projectCache.get(scopeKey, force, () => loadProjects(context.store, context.processManager, url.searchParams.get("rootId")));
    sendJson(res, 200, { projects });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/roots") {
    const config = await context.store.readConfig();
    sendJson(res, 200, {
      roots: config.roots.map((root) => ({
        id: rootId(root),
        path: root
      }))
    });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, { config: await context.store.readConfig() });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/api-lens/targets") {
    const config = await context.store.readConfig();
    sendJson(res, 200, { targets: config.apiLens.targets });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/api-lens/targets") {
    const body = createApiLensTargetSchema.parse(await readJson(req));
    let target;
    try {
      target = createApiLensTarget(body);
    } catch (error) {
      sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
      return true;
    }
    const config = addApiLensTarget(await context.store.readConfig(), target);
    await context.store.writeConfig(config);
    sendJson(res, 200, { target });
    return true;
  }

  const apiLensTargetDelete = url.pathname.match(/^\/api\/api-lens\/targets\/([^/]+)$/);
  if (method === "DELETE" && apiLensTargetDelete) {
    const targetId = decodeURIComponent(apiLensTargetDelete[1] ?? "");
    const config = removeApiLensTarget(await context.store.readConfig(), targetId);
    await context.store.writeConfig(config);
    context.apiLensRecorder.clear(targetId);
    sendJson(res, 200, { deleted: true });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/api-lens/requests") {
    const targetId = url.searchParams.get("targetId") || undefined;
    const rawLimit = Number(url.searchParams.get("limit") ?? "100");
    sendJson(res, 200, {
      requests: context.apiLensRecorder.list({ targetId, limit: Number.isFinite(rawLimit) ? rawLimit : undefined })
    });
    return true;
  }

  if (method === "DELETE" && url.pathname === "/api/api-lens/requests") {
    const targetId = url.searchParams.get("targetId") || undefined;
    context.apiLensRecorder.clear(targetId);
    sendJson(res, 200, { cleared: true });
    return true;
  }

  const apiLensContextMatch = url.pathname.match(/^\/api\/api-lens\/requests\/([^/]+)\/context$/);
  if (method === "GET" && apiLensContextMatch) {
    const record = context.apiLensRecorder.get(decodeURIComponent(apiLensContextMatch[1] ?? ""));
    if (!record) {
      sendJson(res, 404, { error: "API Lens request not found" });
      return true;
    }
    const config = await context.store.readConfig();
    const target = config.apiLens.targets.find((item) => item.id === record.targetId);
    sendJson(res, 200, { context: createApiLensContext(record, target) });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/dialogs/open-folder") {
    const body = openFolderDialogSchema.parse(await readJson(req));
    sendJson(res, 200, await chooseProjectRootFolder(body.initialPath));
    return true;
  }

  if (method === "PATCH" && url.pathname === "/api/config") {
    const body = updateConfigSchema.parse(await readJson(req));
    let config = await context.store.readConfig();
    if (body.editorCommand !== undefined) {
      config = await context.store.updateEditorCommand(body.editorCommand);
    }
    sendJson(res, 200, { config });
    return true;
  }

  if (method === "POST" && url.pathname === "/api/roots") {
    const body = addRootSchema.parse(await readJson(req));
    const config = await context.store.addRoot(body.path);
    context.projectCache.invalidate();
    sendJson(res, 200, { config });
    return true;
  }

  const rootDelete = url.pathname.match(/^\/api\/roots\/([^/]+)$/);
  if (method === "DELETE" && rootDelete) {
    const config = await context.store.removeRoot(rootDelete[1] ?? "");
    context.projectCache.invalidate();
    sendJson(res, 200, { config });
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

export async function handleApiLensProxyRoute(req: IncomingMessage, res: ServerResponse, context: ServerRouteContext): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const match = url.pathname.match(/^\/lens\/([^/]+)\/?(.*)$/);
  if (!match) return false;
  const targetId = decodeURIComponent(match[1] ?? "");
  const config = await context.store.readConfig();
  const target = config.apiLens.targets.find((item) => item.id === targetId);
  if (!target) {
    sendJson(res, 404, { error: "API Lens target not found" });
    return true;
  }
  await handleApiLensProxy(req, res, {
    target,
    targetPath: match[2] ?? "",
    recorder: context.apiLensRecorder
  });
  return true;
}

function readProcessMetrics() {
  const now = Date.now();
  const usage = process.cpuUsage();
  const elapsedMs = Math.max(1, now - cpuSample.at);
  const cpuDeltaMs = (usage.user - cpuSample.usage.user + usage.system - cpuSample.usage.system) / 1000;
  cpuSample = { at: now, usage };
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    uptimeMs: now - startedAt,
    rssMb: roundOne(memory.rss / 1024 / 1024),
    heapUsedMb: roundOne(memory.heapUsed / 1024 / 1024),
    cpuPercent: roundOne((cpuDeltaMs / elapsedMs / Math.max(1, os.cpus().length)) * 100),
    cpuSingleCorePercent: roundOne((cpuDeltaMs / elapsedMs) * 100)
  };
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim().length > 0 ? JSON.parse(raw) : {};
}

export function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}
