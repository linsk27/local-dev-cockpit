import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { execFile, spawn } from "node:child_process";
import http from "node:http";
import https from "node:https";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { WebSocketServer } from "ws";
import { z } from "zod";
import {
  analyzeProject,
  createRecoveryCard,
  decodeProjectId,
  NodeFileSystemAdapter,
  NodeProcessAdapter,
  renderAgentsFile,
  renderProjectContext,
  scanRoot,
  type ErrorSummary,
  type Command,
  type PortStatus,
  type ProcessRun,
  type Project
} from "@local-dev-cockpit/core";
import { EventBus } from "./events.js";
import { stripAnsiControlSequences } from "./log-decoder.js";
import { resolveAppPaths } from "./paths.js";
import {
  diagnoseCommandEnvironment,
  discoverPythonEnvironmentCandidates,
  ProcessManager,
  validatePythonEnvironmentBinding
} from "./process-manager.js";
import { JsonStore, projectEnvironmentForPath, rootId } from "./store.js";

const addRootSchema = z.object({ path: z.string().min(1) });
const openFolderDialogSchema = z.object({ initialPath: z.string().max(500).optional().default("") });
const updateConfigSchema = z.object({ editorCommand: z.string().min(1).max(260).optional() });
const updateProjectEnvironmentSchema = z.object({ python: z.string().max(500).default("") });
const PROJECT_SCAN_CACHE_TTL_MS = 20_000;
const EXTERNAL_PORT_OWNER_CACHE_TTL_MS = 5_000;
const DEFAULT_APP_VERSION = "0.1.12";
const GITHUB_REPOSITORY = "linsk27/local-dev-cockpit";
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases`;
const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;
const NPM_LATEST_URL = "https://registry.npmjs.org/local-dev-cockpit/latest";
const startedAt = Date.now();
let cpuSample = { at: startedAt, usage: process.cpuUsage() };

export interface DevCockpitServerOptions {
  cwd?: string;
  port?: number;
  webRoot?: string;
  version?: string;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export interface ReleaseAssetSummary {
  name: string;
  size: number;
  downloadUrl: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  source?: "github" | "npm";
  releaseUrl?: string;
  installerAsset?: ReleaseAssetSummary;
  portableAsset?: ReleaseAssetSummary;
  checkedAt: string;
  warning?: string;
  error?: string;
}

export async function startDevCockpitServer(options: DevCockpitServerOptions = {}): Promise<RunningServer> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const paths = resolveAppPaths();
  const store = new JsonStore(paths, cwd);
  await store.ensure();
  const eventBus = new EventBus();
  const processManager = new ProcessManager(paths, store, eventBus);
  const projectCache = new ProjectScanCache();
  const webRoot = options.webRoot ? path.resolve(options.webRoot) : undefined;
  const currentVersion = options.version ?? DEFAULT_APP_VERSION;

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, { store, processManager, projectCache, webRoot, currentVersion });
    } catch (error) {
      sendJson(res, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  eventBus.attach(wss);
  server.on("upgrade", (req, socket, head) => {
    if (req.url === "/api/events") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      socket.destroy();
    }
  });

  const port = await listen(server, options.port ?? 8787);
  return {
    port,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      wss.close();
    }
  };
}

async function route(
  req: IncomingMessage,
  res: ServerResponse,
  context: { store: JsonStore; processManager: ProcessManager; projectCache: ProjectScanCache; webRoot?: string; currentVersion: string }
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, name: "Dev Cockpit", version: context.currentVersion });
    return;
  }

  if (method === "GET" && url.pathname === "/api/update") {
    sendJson(res, 200, await checkForUpdates(context.currentVersion));
    return;
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
    return;
  }

  if (method === "GET" && url.pathname === "/api/projects") {
    const force = url.searchParams.get("force") === "1";
    const scopeKey = url.searchParams.get("rootId") || "all";
    const projects = await context.projectCache.get(scopeKey, force, () => loadProjects(context.store, context.processManager, url.searchParams.get("rootId")));
    sendJson(res, 200, { projects });
    return;
  }

  if (method === "GET" && url.pathname === "/api/roots") {
    const config = await context.store.readConfig();
    sendJson(res, 200, {
      roots: config.roots.map((root) => ({
        id: rootId(root),
        path: root
      }))
    });
    return;
  }

  if (method === "GET" && url.pathname === "/api/config") {
    sendJson(res, 200, { config: await context.store.readConfig() });
    return;
  }

  if (method === "POST" && url.pathname === "/api/dialogs/open-folder") {
    const body = openFolderDialogSchema.parse(await readJson(req));
    sendJson(res, 200, await chooseProjectRootFolder(body.initialPath));
    return;
  }

  if (method === "PATCH" && url.pathname === "/api/config") {
    const body = updateConfigSchema.parse(await readJson(req));
    let config = await context.store.readConfig();
    if (body.editorCommand !== undefined) {
      config = await context.store.updateEditorCommand(body.editorCommand);
    }
    sendJson(res, 200, { config });
    return;
  }

  if (method === "POST" && url.pathname === "/api/roots") {
    const body = addRootSchema.parse(await readJson(req));
    const config = await context.store.addRoot(body.path);
    context.projectCache.invalidate();
    sendJson(res, 200, { config });
    return;
  }

  const rootDelete = url.pathname.match(/^\/api\/roots\/([^/]+)$/);
  if (method === "DELETE" && rootDelete) {
    const config = await context.store.removeRoot(rootDelete[1] ?? "");
    context.projectCache.invalidate();
    sendJson(res, 200, { config });
    return;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === "GET" && projectMatch) {
    const project = await loadProject(projectMatch[1] ?? "", context.store, context.processManager);
    sendJson(res, 200, { project });
    return;
  }

  const openProjectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/open-folder$/);
  if (method === "POST" && openProjectMatch) {
    const project = await loadProject(openProjectMatch[1] ?? "", context.store, context.processManager);
    const result = await openProjectFolder(project.path);
    sendJson(res, 200, result);
    return;
  }

  const openEditorMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/open-editor$/);
  if (method === "POST" && openEditorMatch) {
    const project = await loadProject(openEditorMatch[1] ?? "", context.store, context.processManager);
    const config = await context.store.readConfig();
    const result = await openProjectInEditor(project.path, config.editorCommand);
    sendJson(res, 200, result);
    return;
  }

  const startMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/commands\/([^/]+)\/start$/);
  if (method === "POST" && startMatch) {
    const project = await loadProject(startMatch[1] ?? "", context.store, context.processManager);
    const command = project.commands.find((item) => item.id === decodeURIComponent(startMatch[2] ?? ""));
    if (!command) {
      sendJson(res, 404, { error: "Command not found" });
      return;
    }
    const blockReason = commandStartBlockReason(project, command);
    if (blockReason) {
      sendJson(res, 409, { error: blockReason });
      return;
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
      return;
    }
    const run = await context.processManager.start(project.id, command);
    invalidateExternalPortOwnersCache();
    context.projectCache.invalidate();
    sendJson(res, 200, { run });
    return;
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
      return;
    }
    const staleRun = await context.store.markRunStopped(projectId, runId);
    invalidateExternalPortOwnersCache();
    context.projectCache.invalidate();
    sendJson(res, 200, { stopped: false, run: staleRun });
    return;
  }

  const stopPortMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/ports\/(\d+)\/stop$/);
  if (method === "POST" && stopPortMatch) {
    const projectId = decodeURIComponent(stopPortMatch[1] ?? "");
    const port = Number(stopPortMatch[2]);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      sendJson(res, 400, { stopped: false, port, pids: [], error: "Invalid port" });
      return;
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
    return;
  }

  const logMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/logs$/);
  if (method === "GET" && logMatch) {
    const runId = url.searchParams.get("runId") ?? "";
    const logs = runId ? await context.processManager.readLogs(runId) : "";
    sendJson(res, 200, { logs });
    return;
  }

  const contextMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/context$/);
  if (method === "GET" && contextMatch) {
    const project = await loadProject(contextMatch[1] ?? "", context.store, context.processManager);
    sendJson(res, 200, {
      context: renderProjectContext(project),
      agents: renderAgentsFile(project),
      recovery: createRecoveryCard(project)
    });
    return;
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
    return;
  }

  const environmentCandidatesMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/environment\/candidates$/);
  if (method === "GET" && environmentCandidatesMatch) {
    const project = await loadProject(environmentCandidatesMatch[1] ?? "", context.store, context.processManager);
    const candidates = await discoverPythonEnvironmentCandidates(project.path);
    sendJson(res, 200, { candidates });
    return;
  }

  const projectEnvironmentMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/settings$/);
  if (projectEnvironmentMatch) {
    const project = await loadProject(projectEnvironmentMatch[1] ?? "", context.store, context.processManager);
    if (method === "GET") {
      const config = await context.store.readConfig();
      sendJson(res, 200, { environment: projectEnvironmentForPath(config, project.path) ?? { python: "" } });
      return;
    }
    if (method === "PATCH") {
      const body = updateProjectEnvironmentSchema.parse(await readJson(req));
      try {
        await validatePythonEnvironmentBinding(project.path, body.python);
      } catch (error) {
        sendJson(res, 400, { error: error instanceof Error ? error.message : String(error) });
        return;
      }
      const config = await context.store.updateProjectEnvironment(project.path, body.python);
      context.projectCache.invalidate();
      sendJson(res, 200, { environment: projectEnvironmentForPath(config, project.path) ?? { python: "" } });
      return;
    }
  }

  const contextWriteMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/context\/write$/);
  if (method === "POST" && contextWriteMatch) {
    const project = await loadProject(contextWriteMatch[1] ?? "", context.store, context.processManager);
    const result = await writeProjectContextFiles(project);
    sendJson(res, 200, result);
    return;
  }

  await serveStatic(req, res, context.webRoot);
}

export async function writeProjectContextFiles(project: Project): Promise<{ files: string[] }> {
  const contextPath = path.join(project.path, "PROJECT_CONTEXT.md");
  const agentsPath = path.join(project.path, "AGENTS.md");
  await fs.writeFile(contextPath, renderProjectContext(project), "utf8");
  await fs.writeFile(agentsPath, renderAgentsFile(project), "utf8");
  return { files: [contextPath, agentsPath] };
}

export async function openProjectFolder(folderPath: string): Promise<{ opened: true; path: string }> {
  const stat = await fs.stat(folderPath);
  if (!stat.isDirectory()) {
    throw new Error("Project path is not a directory");
  }
  const { command, args } = createOpenFolderCommand(process.platform, folderPath);
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", () => {
    // Opening a folder is best-effort. The API already validated the path.
  });
  child.unref();
  return { opened: true, path: folderPath };
}

export interface FolderPickerResult {
  canceled: boolean;
  path?: string;
}

export async function chooseProjectRootFolder(initialPath?: string): Promise<FolderPickerResult> {
  const initialFolder = await resolveFolderPickerInitialPath(initialPath);
  const command = createFolderPickerCommand(process.platform, initialFolder);
  const result = await runNativeFolderPicker(command);
  if (!result) return { canceled: true };

  const resolved = path.resolve(result);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error("Selected path is not a directory");
  }
  return { canceled: false, path: resolved };
}

export function createOpenFolderCommand(platform: NodeJS.Platform, folderPath: string): { command: string; args: string[] } {
  if (platform === "win32") return { command: "explorer.exe", args: [folderPath] };
  if (platform === "darwin") return { command: "open", args: [folderPath] };
  return { command: "xdg-open", args: [folderPath] };
}

export interface FolderPickerCommand {
  command: string;
  args: string[];
  cancelExitCodes: number[];
  description?: string;
  fallback?: FolderPickerCommand;
}

export function createFolderPickerCommand(platform: NodeJS.Platform, initialPath: string): FolderPickerCommand {
  if (platform === "win32") {
    return createWindowsFormsFolderPickerCommand(initialPath);
  }

  if (platform === "darwin") {
    const script = `POSIX path of (choose folder with prompt "Select project root" default location POSIX file "${escapeAppleScriptString(initialPath)}")`;
    return {
      command: "osascript",
      args: ["-e", script],
      cancelExitCodes: [1]
    };
  }

  return {
    command: "zenity",
    args: ["--file-selection", "--directory", "--title=Select project root", `--filename=${initialPath}${path.sep}`],
    cancelExitCodes: [1],
    fallback: {
      command: "kdialog",
      args: ["--getexistingdirectory", initialPath, "--title", "Select project root"],
      cancelExitCodes: [1]
    }
  };
}

function createWindowsFormsFolderPickerCommand(initialPath: string): FolderPickerCommand {
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Select project root'",
    "$dialog.ShowNewFolderButton = $true",
    `$initialPath = ${quotePowerShellString(initialPath)}`,
    "if (Test-Path -LiteralPath $initialPath) { $dialog.SelectedPath = $initialPath }",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath; exit 0 }",
    "exit 2"
  ].join("; ");
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
    cancelExitCodes: [2],
    description: "Windows Forms folder picker",
    fallback: createWindowsShellFolderPickerCommand(initialPath)
  };
}

function createWindowsShellFolderPickerCommand(initialPath: string): FolderPickerCommand {
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$initialPath = ${quotePowerShellString(initialPath)}`,
    "$shell = New-Object -ComObject Shell.Application",
    "$folder = $shell.BrowseForFolder(0, 'Select project root', 0, $initialPath)",
    "if ($folder -and $folder.Self -and $folder.Self.Path) { Write-Output $folder.Self.Path; exit 0 }",
    "exit 2"
  ].join("; ");
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
    cancelExitCodes: [2],
    description: "Windows Shell folder picker"
  };
}

export async function resolveFolderPickerInitialPath(initialPath?: string): Promise<string> {
  const candidate = initialPath?.trim();
  if (!candidate) return os.homedir();
  const resolved = path.resolve(candidate);
  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) return resolved;
    if (stat.isFile()) return path.dirname(resolved);
  } catch {
    // Fall back to the home directory when the typed value is incomplete or invalid.
  }
  return os.homedir();
}

async function runNativeFolderPicker(command: FolderPickerCommand): Promise<string | undefined> {
  const result = await execFileCapture(command.command, command.args, 120_000);
  if (result.errorCode === "ENOENT") {
    if (command.fallback) return runNativeFolderPicker(command.fallback);
    throw new Error(`Folder picker command not found: ${command.command}`);
  }
  if (result.exitCode === 0) return normalizeFolderPickerOutput(result.stdout);
  if (command.cancelExitCodes.includes(result.exitCode)) return undefined;
  if (command.fallback) return runNativeFolderPicker(command.fallback);
  throw new Error(result.stderr.trim() || result.stdout.trim() || `Folder picker failed with exit code ${result.exitCode}`);
}

function normalizeFolderPickerOutput(output: string): string | undefined {
  const value = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return value || undefined;
}

function execFileCapture(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string; errorCode?: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: false, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      resolve({
        exitCode: typeof code === "number" ? code : error ? 1 : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        errorCode: typeof code === "string" ? code : undefined
      });
    });
  });
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

export async function openProjectInEditor(folderPath: string, editorCommand: string): Promise<{ opened: true; path: string; command: string }> {
  const stat = await fs.stat(folderPath);
  if (!stat.isDirectory()) {
    throw new Error("Project path is not a directory");
  }
  const command = createEditorCommand(process.platform, editorCommand, folderPath);
  const child = spawn(command.command, command.args, { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", () => {
    // Opening an editor is best-effort. The UI reports the configured command for correction if needed.
  });
  child.unref();
  return { opened: true, path: folderPath, command: editorCommand };
}

export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  const checkedAt = new Date().toISOString();
  let githubError: unknown;

  try {
    const release = await fetchLatestGithubRelease(currentVersion);
    const assets = selectUpdateAssets(release.assets);
    return {
      currentVersion,
      latestVersion: release.version,
      hasUpdate: isNewerVersion(release.version, currentVersion),
      source: "github",
      releaseUrl: release.htmlUrl,
      installerAsset: assets.installerAsset,
      portableAsset: assets.portableAsset,
      checkedAt
    };
  } catch (error) {
    githubError = error;
  }

  try {
    const release = buildNpmFallbackRelease(await fetchLatestNpmVersion(currentVersion));
    const assets = selectUpdateAssets(release.assets);
    return {
      currentVersion,
      latestVersion: release.version,
      hasUpdate: isNewerVersion(release.version, currentVersion),
      source: "npm",
      releaseUrl: release.htmlUrl,
      installerAsset: assets.installerAsset,
      portableAsset: assets.portableAsset,
      checkedAt,
      warning: formatNpmFallbackWarning(githubError)
    };
  } catch (npmError) {
    return {
      currentVersion,
      hasUpdate: false,
      checkedAt,
      releaseUrl: `${GITHUB_RELEASES_URL}/latest`,
      error: formatCombinedUpdateCheckError(githubError, npmError)
    };
  }
}

async function fetchLatestGithubRelease(currentVersion: string): Promise<{ version: string; htmlUrl: string; assets: ReleaseAssetSummary[] }> {
  const response = await fetchJsonWithTimeout(LATEST_RELEASE_URL, {
    timeoutMs: 8_000,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": `Dev-Cockpit/${currentVersion}`
    },
    label: "GitHub releases"
  });
  return parseGithubRelease(response);
}

async function fetchLatestNpmVersion(currentVersion: string): Promise<string> {
  const response = await fetchJsonWithTimeout(NPM_LATEST_URL, {
    timeoutMs: 8_000,
    headers: {
      accept: "application/json",
      "user-agent": `Dev-Cockpit/${currentVersion}`
    },
    label: "npm registry"
  });
  return parseNpmLatest(response).version;
}

async function fetchJsonWithTimeout(
  url: string,
  options: { timeoutMs: number; headers: Record<string, string>; label: string }
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: options.headers,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`${options.label} request failed: ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildNpmFallbackRelease(version: string): { version: string; htmlUrl: string; assets: ReleaseAssetSummary[] } {
  const releaseUrl = `${GITHUB_RELEASES_URL}/tag/v${version}`;
  const assetNames = [`Dev-Cockpit-Setup-${version}-win-x64.exe`, `Dev-Cockpit-${version}-win-x64.exe`];
  return {
    version,
    htmlUrl: releaseUrl,
    assets: assetNames.map((name) => ({
      name,
      size: 0,
      downloadUrl: `${GITHUB_RELEASES_URL}/download/v${version}/${name}`
    }))
  };
}

export function parseNpmLatest(raw: unknown): { version: string } {
  if (!raw || typeof raw !== "object") throw new Error("Invalid npm latest response");
  const packageInfo = raw as { version?: unknown };
  const version = typeof packageInfo.version === "string" ? packageInfo.version.trim().replace(/^v/i, "") : "";
  if (!version) throw new Error("npm latest response is missing version");
  return { version };
}

function formatNpmFallbackWarning(error: unknown): string {
  const message = formatUpdateCheckError(error);
  return `${message} 已改用 npm registry 获取最新版本；如果下载按钮仍打不开，请手动访问 GitHub Releases。`;
}

function formatCombinedUpdateCheckError(githubError: unknown, npmError: unknown): string {
  return [
    "无法连接 GitHub Releases，也无法连接 npm registry。",
    "请检查网络、代理或证书设置；如果浏览器能打开 GitHub，可以手动访问发布页下载。",
    `GitHub：${formatUpdateCheckError(githubError)}`,
    `npm：${formatRegistryCheckError(npmError)}`
  ].join(" ");
}

export function formatUpdateCheckError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "AbortError") {
    return "连接 GitHub Releases 超时。请检查网络或代理，或手动打开 GitHub Release 页面下载。";
  }
  if (/fetch failed|network|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|certificate|self signed/i.test(message)) {
    return "无法连接 GitHub Releases。请检查网络、代理或证书设置；也可以手动打开 GitHub Release 页面下载。";
  }
  const status = message.match(/GitHub releases request failed:\s*(\d+)/i)?.[1];
  if (status === "403") {
    return "GitHub API 暂时限流或拒绝访问。请稍后重试，或手动打开 GitHub Release 页面下载。";
  }
  if (status === "404") {
    return "没有找到可用的 GitHub Release。请稍后重试或检查项目发布页。";
  }
  if (status) {
    return `GitHub Releases 返回 ${status}。请稍后重试，或手动打开 GitHub Release 页面下载。`;
  }
  return message || "检查更新失败。请稍后重试，或手动打开 GitHub Release 页面下载。";
}

function formatRegistryCheckError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "AbortError") return "连接 npm registry 超时。";
  if (/fetch failed|network|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|certificate|self signed/i.test(message)) {
    return "无法连接 npm registry。";
  }
  const status = message.match(/npm registry request failed:\s*(\d+)/i)?.[1];
  if (status) return `npm registry 返回 ${status}。`;
  return message || "npm registry 检查失败。";
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const left = normalizeVersion(candidate);
  const right = normalizeVersion(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta > 0) return true;
    if (delta < 0) return false;
  }
  return false;
}

export function selectUpdateAssets(assets: ReleaseAssetSummary[]): {
  installerAsset?: ReleaseAssetSummary;
  portableAsset?: ReleaseAssetSummary;
} {
  const exeAssets = assets.filter((asset) => /\.exe$/i.test(asset.name));
  return {
    installerAsset:
      exeAssets.find((asset) => /setup/i.test(asset.name) && /win/i.test(asset.name)) ??
      exeAssets.find((asset) => /installer/i.test(asset.name)),
    portableAsset:
      exeAssets.find((asset) => !/setup|installer/i.test(asset.name) && /win/i.test(asset.name)) ??
      exeAssets.find((asset) => !/setup|installer/i.test(asset.name))
  };
}

function normalizeVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function parseGithubRelease(raw: unknown): { version: string; htmlUrl: string; assets: ReleaseAssetSummary[] } {
  if (!raw || typeof raw !== "object") throw new Error("Invalid GitHub release response");
  const release = raw as {
    tag_name?: unknown;
    html_url?: unknown;
    assets?: Array<{ name?: unknown; size?: unknown; browser_download_url?: unknown }>;
  };
  const version = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/i, "") : "";
  const htmlUrl = typeof release.html_url === "string" ? release.html_url : "";
  if (!version || !htmlUrl) throw new Error("GitHub release response is missing tag or URL");
  return {
    version,
    htmlUrl,
    assets: (release.assets ?? [])
      .filter((asset) => typeof asset.name === "string" && typeof asset.browser_download_url === "string")
      .map((asset) => ({
        name: asset.name as string,
        size: typeof asset.size === "number" ? asset.size : 0,
        downloadUrl: asset.browser_download_url as string
      }))
  };
}

export function createEditorCommand(platform: NodeJS.Platform, editorCommand: string, folderPath: string): { command: string; args: string[] } {
  const parsed = parseEditorCommand(editorCommand);
  if (platform !== "win32" || isDirectWindowsExecutable(parsed.command)) {
    return { command: parsed.command, args: [...parsed.args, folderPath] };
  }
  return { command: "cmd.exe", args: ["/d", "/s", "/c", parsed.command, ...parsed.args, folderPath] };
}

export function parseEditorCommand(editorCommand: string): { command: string; args: string[] } {
  const trimmed = editorCommand.trim();
  const windowsExecutablePath = trimmed.match(/^([A-Za-z]:\\.*?\.exe|\\\\.*?\.exe)(?:\s+(.*))?$/i);
  if (windowsExecutablePath?.[1]) {
    return {
      command: windowsExecutablePath[1],
      args: tokenizeCommandLine(windowsExecutablePath[2] ?? "")
    };
  }

  const [command, ...args] = tokenizeCommandLine(trimmed);
  if (!command) throw new Error("Editor command is empty");
  return { command, args };
}

function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Editor command has an unclosed quote");
  if (current) tokens.push(current);
  return tokens;
}

function isDirectWindowsExecutable(command: string): boolean {
  return /[\\/]/.test(command) || /\.exe$/i.test(command);
}

export function commandStartBlockReason(project: Project, command: Command): string | undefined {
  if (project.lastRun?.status === "running") {
    return project.lastRun.commandId === command.id
      ? "该命令已经在运行，请使用停止按钮结束它。"
      : "该项目已有命令正在运行，请先停止当前命令。";
  }

  const openPorts = project.ports.filter((port) => port.status === "open" && port.source !== "common");
  if (commandWouldTouchPorts(command, openPorts)) {
    return "服务已经在线，已阻止重复启动。需要重启时请先停止当前端口。";
  }

  const stalePorts = project.ports.filter((port) => port.status === "unknown" && port.source === "detected");
  if (commandWouldTouchPorts(command, stalePorts)) {
    return "检测到残留端口占用，已阻止启动。请先清理端口后再运行。";
  }

  return undefined;
}

function commandWouldTouchPorts(command: Command, ports: PortStatus[]): boolean {
  if (ports.length === 0) return false;
  const declaredPorts = commandDeclaredPorts(command);
  if (declaredPorts.length > 0) return declaredPorts.some((port) => ports.some((item) => item.port === port));
  return command.kind === "dev" || command.kind === "start";
}

function commandDeclaredPorts(command: Command): number[] {
  const ports = new Set<number>(command.ports ?? []);
  const text = `${command.command} ${command.args.join(" ")}`;
  const patterns = [
    /(?:--(?:port|server\.port)(?:=|\s+)|-p\s+|(?:^|\s)[A-Z_]*PORT=)(\d{2,5})/gi,
    /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port);
    }
  }
  return [...ports];
}

async function loadProjects(store: JsonStore, processManager: ProcessManager, selectedRootId?: string | null): Promise<Project[]> {
  const config = await store.readConfig();
  const state = await store.readState();
  const projects: Project[] = [];
  const roots = selectedRootId ? config.roots.filter((root) => rootId(root) === selectedRootId) : config.roots;

  for (const root of roots) {
    const result = await scanRoot(root, { ignoreNames: config.ignoreNames });
    projects.push(...result.projects);
  }

  const enrichment = await createEnrichmentContext(projects);
  return Promise.all(
    projects.map((project) => enrichProject(project, state.runs[project.id], state.errors[project.id], processManager, enrichment))
  );
}

async function loadProject(id: string, store: JsonStore, processManager: ProcessManager): Promise<Project> {
  const projectPath = decodeProjectId(id);
  const state = await store.readState();
  const project = await analyzeProject(projectPath, {
    fs: new NodeFileSystemAdapter(),
    process: new NodeProcessAdapter()
  });
  return enrichProject(project, state.runs[project.id], state.errors[project.id], processManager, await createEnrichmentContext([project]));
}

class ProjectScanCache {
  private readonly entries = new Map<string, ProjectScanCacheEntry>();

  async get(key: string, force: boolean, load: () => Promise<Project[]>): Promise<Project[]> {
    const now = Date.now();
    const entry = this.entry(key);
    if (!force && entry.projects && entry.expiresAt > now) {
      entry.hits += 1;
      return entry.projects;
    }
    if (!force && entry.inflight) {
      entry.joined += 1;
      return entry.inflight;
    }

    entry.misses += 1;
    const started = Date.now();
    entry.inflight = load()
      .then((projects) => {
        entry.projects = projects;
        entry.expiresAt = Date.now() + PROJECT_SCAN_CACHE_TTL_MS;
        entry.lastScanDurationMs = Date.now() - started;
        entry.lastProjectCount = projects.length;
        entry.lastScannedAt = new Date().toISOString();
        return projects;
      })
      .finally(() => {
        entry.inflight = undefined;
      });
    return entry.inflight;
  }

  invalidate(): void {
    for (const entry of this.entries.values()) {
      entry.expiresAt = 0;
    }
  }

  snapshot(key: string) {
    const entry = this.entries.get(key);
    const now = Date.now();
    return {
      scope: key,
      status: entry?.inflight ? "scanning" : entry?.projects && entry.expiresAt > now ? "cached" : entry?.projects ? "stale" : "empty",
      cacheExpiresInMs: entry?.projects ? Math.max(0, entry.expiresAt - now) : 0,
      lastScanDurationMs: entry?.lastScanDurationMs ?? 0,
      lastProjectCount: entry?.lastProjectCount ?? 0,
      lastScannedAt: entry?.lastScannedAt,
      cacheHits: entry?.hits ?? 0,
      cacheMisses: entry?.misses ?? 0,
      joinedRequests: entry?.joined ?? 0
    };
  }

  private entry(key: string): ProjectScanCacheEntry {
    const current = this.entries.get(key);
    if (current) return current;
    const next: ProjectScanCacheEntry = {
      expiresAt: 0,
      hits: 0,
      misses: 0,
      joined: 0,
      lastScanDurationMs: 0,
      lastProjectCount: 0
    };
    this.entries.set(key, next);
    return next;
  }
}

interface ProjectScanCacheEntry {
  expiresAt: number;
  projects?: Project[];
  inflight?: Promise<Project[]>;
  hits: number;
  misses: number;
  joined: number;
  lastScanDurationMs: number;
  lastProjectCount: number;
  lastScannedAt?: string;
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

async function enrichProject(
  project: Project,
  lastRun: ProcessRun | undefined,
  lastError: ErrorSummary | undefined,
  processManager: ProcessManager,
  enrichment: EnrichmentContext
): Promise<Project> {
  const managedRun = normalizeManagedRun(lastRun, processManager);
  const logPorts = managedRun
    ? await extractPortsFromLogs(await processManager.readLogs(managedRun.id), managedRun.status, project.path)
    : [];
  const externalPorts = await findExternalProjectPorts(project, enrichment.externalPortOwnersByProject.get(project.id) ?? [], logPorts);
  const processPorts = filterStaleLogPorts(project.id, managedRun, logPorts, externalPorts, enrichment.externalPortClaims);
  const scannedPorts = await normalizeScannedPorts(project, externalPorts, enrichment.detectedPortCounts);
  const hydratedRun = hydrateLastRun(managedRun, processPorts);
  const obsoleteToolFailure = isObsoleteMissingToolFailure(project, hydratedRun, lastError);
  const currentRun = obsoleteToolFailure ? undefined : hydratedRun;
  const currentError = obsoleteToolFailure || isStaleError(currentRun, lastError) ? undefined : lastError;

  return {
    ...project,
    ports: mergePorts([...scannedPorts, ...externalPorts], processPorts),
    lastRun: currentRun,
    lastError: currentError
  };
}

interface EnrichmentContext {
  externalPortOwnersByProject: Map<string, ExternalPortOwner[]>;
  externalPortClaims: Map<number, Set<string>>;
  detectedPortCounts: Map<number, number>;
}

export interface ExternalPortOwner {
  port: number;
  host?: string;
  pid: number;
  commandLine: string;
}

async function createEnrichmentContext(projects: Project[]): Promise<EnrichmentContext> {
  const externalPortOwners = await getCachedExternalPortOwners(new NodeProcessAdapter());
  const externalPortOwnersByProject = assignExternalPortOwners(projects, externalPortOwners);
  return {
    externalPortOwnersByProject,
    externalPortClaims: mapExternalPortClaims(externalPortOwnersByProject),
    detectedPortCounts: countDetectedPortOwners(projects)
  };
}

let externalPortOwnersCache: { expiresAt: number; owners: ExternalPortOwner[] } | undefined;
let externalPortOwnersInflight: Promise<ExternalPortOwner[]> | undefined;
let externalPortOwnersCacheVersion = 0;

function invalidateExternalPortOwnersCache(): void {
  externalPortOwnersCacheVersion += 1;
  externalPortOwnersCache = undefined;
  externalPortOwnersInflight = undefined;
}

async function getCachedExternalPortOwners(processAdapter: NodeProcessAdapter): Promise<ExternalPortOwner[]> {
  const now = Date.now();
  if (externalPortOwnersCache && externalPortOwnersCache.expiresAt > now) return externalPortOwnersCache.owners;
  if (externalPortOwnersInflight) return externalPortOwnersInflight;

  const cacheVersion = externalPortOwnersCacheVersion;
  externalPortOwnersInflight = detectExternalPortOwners(processAdapter)
    .then((owners) => {
      if (cacheVersion === externalPortOwnersCacheVersion) {
        externalPortOwnersCache = { expiresAt: Date.now() + EXTERNAL_PORT_OWNER_CACHE_TTL_MS, owners };
      }
      return owners;
    })
    .finally(() => {
      if (cacheVersion === externalPortOwnersCacheVersion) {
        externalPortOwnersInflight = undefined;
      }
    });
  return externalPortOwnersInflight;
}

function mapExternalPortClaims(externalPortOwnersByProject: Map<string, ExternalPortOwner[]>): Map<number, Set<string>> {
  const claims = new Map<number, Set<string>>();
  for (const [projectId, owners] of externalPortOwnersByProject) {
    for (const owner of owners) {
      const projectIds = claims.get(owner.port) ?? new Set<string>();
      projectIds.add(projectId);
      claims.set(owner.port, projectIds);
    }
  }
  return claims;
}

export function assignExternalPortOwners(projects: Project[], owners: ExternalPortOwner[]): Map<string, ExternalPortOwner[]> {
  const byProject = new Map<string, ExternalPortOwner[]>();
  for (const owner of owners) {
    const matches = projects
      .filter((project) => commandLineReferencesProject(owner.commandLine, project.path))
      .map((project) => ({
        project,
        pathLength: normalizePathText(path.resolve(project.path)).length
      }));
    if (matches.length === 0) continue;
    const bestLength = Math.max(...matches.map((match) => match.pathLength));
    for (const { project } of matches.filter((match) => match.pathLength === bestLength)) {
      byProject.set(project.id, [...(byProject.get(project.id) ?? []), owner]);
    }
  }
  return byProject;
}

function countDetectedPortOwners(projects: Project[]): Map<number, number> {
  const ownersByPort = new Map<number, Set<string>>();
  for (const project of projects) {
    for (const port of project.ports) {
      if (port.source !== "detected") continue;
      const owners = ownersByPort.get(port.port) ?? new Set<string>();
      owners.add(project.id);
      ownersByPort.set(port.port, owners);
    }
  }
  return new Map([...ownersByPort.entries()].map(([port, owners]) => [port, owners.size]));
}

/**
 * Keeps detected ports visible only when they are defensible. A declared port is
 * trusted if the OS process command line references this project, or if the
 * unique declared port responds to a lightweight HTTP probe. Otherwise it is
 * marked stale instead of being shown as an online browser endpoint.
 */
export async function normalizeScannedPorts(
  project: Project,
  externalPorts: PortStatus[],
  detectedPortCounts: Map<number, number>
): Promise<PortStatus[]> {
  const externallyMatched = new Set(externalPorts.map((port) => port.port));
  return Promise.all(project.ports.map(async (port) => {
    if (port.source !== "detected" || port.status !== "open") return port;
    if (externallyMatched.has(port.port)) return port;
    if ((detectedPortCounts.get(port.port) ?? 0) > 1) return { ...port, source: "common" };
    const reachable = await resolveReachableScannedPort(port);
    if (reachable) return reachable;
    return { ...port, status: "unknown" };
  }));
}

async function resolveReachableScannedPort(port: PortStatus): Promise<PortStatus | undefined> {
  for (const candidate of externalListenerProbeCandidates(port.port, port.host)) {
    if (await isLocalHttpEndpointReachable(candidate, 700)) {
      return {
        ...port,
        host: candidate.host,
        url: candidate.url,
        status: "open"
      };
    }
  }
  return undefined;
}

export function filterStaleLogPorts(
  projectId: string,
  managedRun: ProcessRun | undefined,
  logPorts: PortStatus[],
  externalPorts: PortStatus[],
  externalPortClaims: Map<number, Set<string>>
): PortStatus[] {
  if (managedRun?.status === "running") return logPorts;
  const ownExternallyMatchedPorts = new Set(externalPorts.map((port) => port.port));
  return logPorts.filter((port) => {
    if (ownExternallyMatchedPorts.has(port.port)) return false;
    if (port.status !== "open") return true;
    const claimants = externalPortClaims.get(port.port);
    return !claimants || claimants.size === 0 || claimants.has(projectId);
  });
}

export async function findExternalProjectPorts(project: Project, owners: ExternalPortOwner[], knownPortHints: PortStatus[] = []): Promise<PortStatus[]> {
  const ports = new Map<string, PortStatus>();
  const knownPorts = projectKnownPortNumbers(project, knownPortHints);
  for (const owner of owners) {
    if (!commandLineReferencesProject(owner.commandLine, project.path)) continue;
    const resolved = await resolveExternalProjectEndpoint(owner);
    const isKnownEntrypoint = knownPorts.has(owner.port);
    if (!resolved.reachable && !isKnownEntrypoint) continue;
    const endpoint: PortStatus = {
      port: owner.port,
      host: resolved.host,
      url: resolved.url,
      status: resolved.reachable ? "open" : "unknown",
      source: "detected"
    };
    ports.set(portKey(endpoint), endpoint);
  }
  return [...ports.values()];
}

function projectKnownPortNumbers(project: Project, hints: PortStatus[]): Set<number> {
  return new Set([
    ...project.ports.filter((port) => port.source !== "common" || port.status === "open").map((port) => port.port),
    ...hints.map((port) => port.port)
  ]);
}

async function detectExternalPortOwners(processAdapter: NodeProcessAdapter): Promise<ExternalPortOwner[]> {
  if (process.platform !== "win32") return [];
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    "$processes = @{}",
    "Get-CimInstance Win32_Process | ForEach-Object { $processes[[int]$_.ProcessId] = $_.CommandLine }",
    "$connections = @(Get-NetTCPConnection -State Listen | Where-Object { @('127.0.0.1','::1','0.0.0.0','::') -contains $_.LocalAddress })",
    "$items = foreach ($connection in $connections) {",
    "  $pidValue = [int]$connection.OwningProcess",
    "  $commandLine = ''",
    "  if ($processes.ContainsKey($pidValue) -and $processes[$pidValue]) { $commandLine = [string]$processes[$pidValue] }",
    "  [pscustomobject]@{ port = [int]$connection.LocalPort; host = [string]$connection.LocalAddress; pid = $pidValue; commandLine = $commandLine }",
    "}",
    "@($items) | ConvertTo-Json -Compress"
  ].join("; ");
  const result = await processAdapter.execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeoutMs: 8000
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];
  return parseExternalPortOwners(result.stdout);
}

export function parseExternalPortOwners(raw: string): ExternalPortOwner[] {
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      const port = Number(item.port);
      const pid = Number(item.pid);
      if (!Number.isInteger(port) || port <= 0 || port > 65535 || !Number.isInteger(pid)) return [];
      return [
        {
          port,
          pid,
          host: typeof item.host === "string" ? item.host : undefined,
          commandLine: typeof item.commandLine === "string" ? item.commandLine : ""
        }
      ];
    });
  } catch {
    return [];
  }
}

export function commandLineReferencesProject(commandLine: string, projectPath: string): boolean {
  const normalizedCommandLine = normalizePathText(commandLine);
  const normalizedProjectPath = normalizePathText(path.resolve(projectPath));
  if (!normalizedCommandLine || !normalizedProjectPath) return false;

  let index = normalizedCommandLine.indexOf(normalizedProjectPath);
  while (index >= 0) {
    const before = normalizedCommandLine[index - 1] ?? " ";
    const after = normalizedCommandLine[index + normalizedProjectPath.length] ?? " ";
    if (isPathBoundary(before, "before") && isPathBoundary(after, "after")) return true;
    index = normalizedCommandLine.indexOf(normalizedProjectPath, index + 1);
  }
  return false;
}

function normalizeManagedRun(lastRun: ProcessRun | undefined, processManager: ProcessManager): ProcessRun | undefined {
  if (!lastRun || lastRun.status !== "running" || processManager.isRunning(lastRun.id)) return lastRun;
  return {
    ...lastRun,
    status: "stopped",
    exitedAt: lastRun.exitedAt ?? new Date().toISOString()
  };
}

function hydrateLastRun(lastRun: ProcessRun | undefined, processPorts: PortStatus[]): ProcessRun | undefined {
  if (!lastRun || lastRun.status !== "running" || processPorts.length === 0) return lastRun;
  if (processPorts.some((port) => port.status === "open")) return lastRun;
  return {
    ...lastRun,
    status: "stopped",
    exitedAt: lastRun.exitedAt ?? new Date().toISOString()
  };
}

function isStaleError(lastRun: ProcessRun | undefined, lastError: ErrorSummary | undefined): boolean {
  if (!lastRun || !lastError) return false;
  if (lastRun.status === "failed") return false;
  return new Date(lastRun.startedAt).getTime() >= new Date(lastError.occurredAt).getTime();
}

export function isObsoleteMissingToolFailure(project: Project, lastRun: ProcessRun | undefined, lastError: ErrorSummary | undefined): boolean {
  if (lastRun?.status !== "failed" || !lastError?.commandId) return false;
  const currentCommand = project.commands.find((command) => command.id === lastError.commandId);
  if (!currentCommand) return true;
  const missingTool = parseMissingToolName(lastError.message);
  return Boolean(missingTool && missingTool !== currentCommand.command.toLowerCase());
}

export function parseMissingToolName(message: string): string | undefined {
  const quoted = message.match(/['"`]?(npm|npx|pnpm|yarn|bun)(?:\.cmd)?['"`]?\s+(?:不是内部或外部命令|is not recognized|not found|未安装|不在 PATH)/i);
  return quoted?.[1]?.toLowerCase();
}

async function extractPortsFromLogs(logs: string, status: ProcessRun["status"], projectPath: string): Promise<PortStatus[]> {
  const ports = new Map<string, Pick<PortStatus, "port" | "host" | "url">>();
  const cleanLogs = stripAnsiControlSequences(logs);
  const processAdapter = new NodeProcessAdapter();
  const existingServer = logIndicatesExistingServer(cleanLogs, projectPath);

  for (const endpoint of parseLocalEndpointsFromLogs(cleanLogs)) {
    const resolved = await resolveReachableEndpoint(processAdapter, endpoint);
    ports.set(`${resolved.host ?? "host"}:${resolved.port}`, resolved);
  }

  const statuses: PortStatus[] = [];
  const shouldProbeEndpoint = status === "running" || existingServer;
  for (const endpoint of ports.values()) {
    const isOpen = shouldProbeEndpoint && (await isEndpointOpen(processAdapter, endpoint));
    statuses.push({
      ...endpoint,
      status: isOpen ? "open" : "closed",
      source: status === "running" ? "process" : "detected"
    });
  }
  return statuses;
}

export function parseLocalEndpointsFromLogs(logs: string): Pick<PortStatus, "port" | "host" | "url">[] {
  const ports = new Map<string, Pick<PortStatus, "port" | "host" | "url">>();
  for (const match of logs.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{2,5})?(?:\/[^\s]*)?/gi)) {
    try {
      const url = new URL(match[0]);
      if (!url.port) continue;
      const port = Number(url.port);
      if (Number.isInteger(port) && port > 0 && port < 65536) {
        const host = normalizePortHost(url.hostname);
        const endpoint = {
          port,
          host,
          url: `${url.protocol}//${url.host}`
        };
        ports.set(`${endpoint.host ?? "host"}:${endpoint.port}`, endpoint);
      }
    } catch {
      // Ignore partial URLs emitted by colored terminal output.
    }
  }
  return [...ports.values()];
}

export function logIndicatesExistingServer(logs: string, projectPath?: string): boolean {
  if (/another .+server.+already running/i.test(logs) && projectPath) {
    const existingDir = parseExistingServerDir(logs);
    if (existingDir && normalizeComparablePath(existingDir) !== normalizeComparablePath(projectPath)) return false;
  }
  return /another .+server.+already running|already running|address already in use|eaddrinuse|port \d+ is in use/i.test(logs);
}

function parseExistingServerDir(logs: string): string | undefined {
  const match = logs.match(/^\s*-\s*Dir:\s*(.+?)\s*$/im) ?? logs.match(/\bDir:\s*([A-Za-z]:\\.+?)(?:\s+-\s+|\s+Run\s+|$)/i);
  return match?.[1]?.trim();
}

function normalizeComparablePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function normalizePathText(value: string): string {
  return value.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function isPathBoundary(character: string, side: "before" | "after"): boolean {
  if (/[\s"'`]/.test(character)) return true;
  return side === "after" ? character === "/" : true;
}

function formatLocalUrl(port: number, host: string): string {
  return `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
}

interface ResolvedExternalProjectEndpoint {
  host: string;
  url: string;
  reachable: boolean;
}

interface LocalProbeEndpoint {
  port: number;
  host: string;
  url: string;
}

async function resolveExternalProjectEndpoint(owner: Pick<ExternalPortOwner, "port" | "host">): Promise<ResolvedExternalProjectEndpoint> {
  const candidates = externalListenerProbeCandidates(owner.port, owner.host);
  for (const candidate of candidates) {
    if (await isLocalHttpEndpointReachable(candidate)) {
      return { ...candidate, reachable: true };
    }
  }
  return { ...candidates[0], reachable: false };
}

export function externalListenerProbeCandidates(port: number, host: string | undefined): LocalProbeEndpoint[] {
  const normalized = normalizePortHost(host ?? "localhost");
  const hosts =
    normalized === "0.0.0.0"
      ? ["127.0.0.1", "localhost"]
      : normalized === "::"
        ? ["127.0.0.1", "::1", "localhost"]
        : normalized === "localhost"
          ? ["127.0.0.1", "localhost", "::1"]
          : normalized
            ? [normalized]
            : ["127.0.0.1", "localhost"];
  const uniqueHosts = [...new Set(hosts)];
  return uniqueHosts.map((candidateHost) => ({
    port,
    host: candidateHost,
    url: formatLocalUrl(port, candidateHost)
  }));
}

async function isEndpointOpen(processAdapter: NodeProcessAdapter, endpoint: Pick<PortStatus, "port" | "host">): Promise<boolean> {
  if ("url" in endpoint && typeof endpoint.url === "string") {
    return isLocalHttpEndpointReachable(endpoint as Pick<PortStatus, "port" | "host" | "url">);
  }
  if (!endpoint.host || endpoint.host === "localhost") return processAdapter.isPortOpen(endpoint.port);
  return processAdapter.isPortOpen(endpoint.port, endpoint.host);
}

export function isLocalHttpEndpointReachable(endpoint: Pick<PortStatus, "port" | "host" | "url">, timeoutMs = 2500): Promise<boolean> {
  const targetUrl = endpoint.url ?? formatLocalUrl(endpoint.port, endpoint.host ?? "localhost");
  return new Promise((resolve) => {
    let finished = false;
    let request: http.ClientRequest | undefined;
    const finish = (reachable: boolean) => {
      if (finished) return;
      finished = true;
      request?.destroy();
      resolve(reachable);
    };
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      resolve(false);
      return;
    }
    const client = parsed.protocol === "https:" ? https : http;
    const options: http.RequestOptions & { rejectUnauthorized?: boolean } = {
      method: "GET",
      timeout: timeoutMs,
      headers: { "user-agent": "Dev-Cockpit/health-check" },
      rejectUnauthorized: false
    };
    request = client.request(
      parsed,
      options,
      (response) => {
        response.resume();
        finish(true);
      }
    );
    request.once("timeout", () => finish(false));
    request.once("error", () => finish(false));
    request.end();
  });
}

async function resolveReachableEndpoint(
  processAdapter: NodeProcessAdapter,
  endpoint: Pick<PortStatus, "port" | "host" | "url">
): Promise<Pick<PortStatus, "port" | "host" | "url">> {
  if (endpoint.url) return endpoint;
  if (endpoint.host !== "localhost") return endpoint;
  const protocol = endpoint.url?.startsWith("https:") ? "https" : "http";
  if (await processAdapter.isPortOpen(endpoint.port, "127.0.0.1")) {
    return { port: endpoint.port, host: "127.0.0.1", url: `${protocol}://127.0.0.1:${endpoint.port}` };
  }
  if (await processAdapter.isPortOpen(endpoint.port, "::1")) {
    return { port: endpoint.port, host: "::1", url: `${protocol}://[::1]:${endpoint.port}` };
  }
  return endpoint;
}

function mergePorts(detected: PortStatus[], processPorts: PortStatus[]): PortStatus[] {
  const byPort = new Map<string, PortStatus>();
  for (const port of detected) {
    byPort.set(portKey(port), port);
  }
  for (const port of processPorts) {
    const existingSamePort = [...byPort.values()].filter((existing) => existing.port === port.port);
    if (port.status !== "open" && existingSamePort.some((existing) => existing.status === "open" && existing.source !== "common")) {
      continue;
    }
    for (const [key, existing] of byPort) {
      if (existing.port === port.port && existing.source !== "process") byPort.delete(key);
    }
    byPort.set(portKey(port), port);
  }
  return [...byPort.values()].sort((left, right) => left.port - right.port || (left.host ?? "").localeCompare(right.host ?? ""));
}

function normalizePortHost(host: string): string {
  return host.replace(/^\[|\]$/g, "");
}

function portKey(port: PortStatus): string {
  return port.host ? `${port.host}:${port.port}:${port.source}` : `${port.port}:${port.source}`;
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.trim().length > 0 ? JSON.parse(raw) : {};
}

function sendJson(res: ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

async function serveStatic(req: IncomingMessage, res: ServerResponse, webRoot?: string): Promise<void> {
  if (!webRoot) {
    sendJson(res, 404, { error: "Web assets not found. Build apps/web first." });
    return;
  }

  const url = new URL(req.url ?? "/", "http://localhost");
  const cleanPath = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const filePath = path.resolve(webRoot, `.${cleanPath}`);
  const root = path.resolve(webRoot);

  if (!filePath.startsWith(root)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const file = await fs.readFile(filePath);
    res.writeHead(200, { "content-type": contentType(filePath) });
    res.end(file);
  } catch {
    try {
      const file = await fs.readFile(path.join(root, "index.html"));
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(file);
    } catch {
      sendJson(res, 404, { error: "Not found" });
    }
  }
}

function contentType(filePath: string): string {
  if (filePath.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (filePath.endsWith(".css")) return "text/css; charset=utf-8";
  if (filePath.endsWith(".svg")) return "image/svg+xml";
  if (filePath.endsWith(".html")) return "text/html; charset=utf-8";
  return "application/octet-stream";
}

async function listen(server: ReturnType<typeof createServer>, preferredPort: number): Promise<number> {
  for (let port = preferredPort; port <= preferredPort + 12; port += 1) {
    const result = await new Promise<"ok" | "busy">((resolve, reject) => {
      server.once("error", (error: NodeJS.ErrnoException) => {
        server.removeAllListeners("listening");
        if (error.code === "EADDRINUSE") resolve("busy");
        else reject(error);
      });
      server.once("listening", () => {
        server.removeAllListeners("error");
        resolve("ok");
      });
      server.listen(port, "127.0.0.1");
    });
    if (result === "ok") return port;
  }
  throw new Error(`No free port found near ${preferredPort}`);
}

export interface StopPortResult {
  stopped: boolean;
  port: number;
  pids: number[];
  alreadyClosed?: boolean;
  error?: string;
}

export async function stopPort(port: number): Promise<StopPortResult> {
  const processAdapter = new NodeProcessAdapter();
  const pids = await findListeningPidsByPort(processAdapter, port);
  const killablePids = pids.filter((pid) => pid > 0 && pid !== process.pid);
  if (killablePids.length === 0) {
    if (pids.includes(process.pid)) {
      return { stopped: false, port, pids, error: "Refusing to stop Dev Cockpit itself" };
    }
    const stillOpen = await processAdapter.isPortOpen(port);
    if (!stillOpen) {
      return { stopped: true, port, pids, alreadyClosed: true };
    }
    return {
      stopped: false,
      port,
      pids,
      error: "Port is open, but Dev Cockpit could not find an owning process. Close the terminal that started it or retry with administrator permissions."
    };
  }

  const failures: string[] = [];
  const actions: string[] = [];
  for (const pid of killablePids) {
    const result =
      process.platform === "win32"
        ? await stopWindowsPid(processAdapter, pid)
        : await stopUnixPid(processAdapter, pid);
    if (!result.ok) {
      failures.push(result.message);
    } else {
      actions.push(result.message);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 800));
  const stillOpen = await processAdapter.isPortOpen(port);
  if (!stillOpen) {
    return {
      stopped: true,
      port,
      pids: killablePids,
      alreadyClosed: failures.length > 0
    };
  }

  return {
    stopped: false,
    port,
    pids: killablePids,
    error:
      failures.length > 0
        ? failures.join("\n")
        : [...actions, "端口仍在监听。父进程可能不可见或由系统代理托管，请关闭启动它的终端，或用管理员权限重新运行 Dev Cockpit。"].join("\n")
  };
}

interface StopPidResult {
  ok: boolean;
  message: string;
}

async function stopWindowsPid(processAdapter: NodeProcessAdapter, pid: number): Promise<StopPidResult> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$targetPid = ${pid}`,
    "$targetProcess = Get-Process -Id $targetPid -ErrorAction SilentlyContinue",
    "$children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $targetPid -and $_.Name -ne 'conhost.exe' })",
    "if ($targetProcess) { Stop-Process -Id $targetPid -Force -ErrorAction Stop; Write-Output 'STOPPED_TARGET'; exit 0 }",
    "if ($children.Count -eq 0) { Write-Output 'PID_NOT_FOUND'; exit 2 }",
    "$childPids = @($children | Select-Object -ExpandProperty ProcessId)",
    "foreach ($childPid in $childPids) { Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue }",
    "Write-Output ('STOPPED_CHILDREN:' + ($childPids -join ','))"
  ].join("; ");
  const result = await processAdapter.execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeoutMs: 6000
  });
  const stoppedChildren = parseStoppedChildrenOutput(result.stdout);
  if (stoppedChildren.length > 0) {
    return {
      ok: true,
      message: `Windows 端口父进程 PID ${pid} 不可见，已尝试停止可见子进程 ${stoppedChildren.join(", ")}。`
    };
  }
  if (result.exitCode === 0) return { ok: true, message: `Stopped PID ${pid}` };
  if (result.stdout.includes("PID_NOT_FOUND")) {
    return {
      ok: false,
      message: `Windows 报告端口属于 PID ${pid}，但系统进程列表中找不到该进程，也没有可停止的可见子进程；可能是权限不足、进程已退出但端口表未刷新，或该端口由系统代理托管。`
    };
  }
  return { ok: false, message: result.stderr || result.stdout || `停止 PID ${pid} 失败` };
}

export function parseStoppedChildrenOutput(output: string): number[] {
  const match = output.match(/STOPPED_CHILDREN:([0-9,\s]+)/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function stopUnixPid(processAdapter: NodeProcessAdapter, pid: number): Promise<StopPidResult> {
  const result = await processAdapter.execFile("kill", ["-TERM", String(pid)], { timeoutMs: 6000 });
  if (result.exitCode === 0) return { ok: true, message: `Stopped PID ${pid}` };
  return { ok: false, message: result.stderr || result.stdout || `停止 PID ${pid} 失败` };
}

async function findListeningPidsByPort(processAdapter: NodeProcessAdapter, port: number): Promise<number[]> {
  if (process.platform === "win32") {
    const result = await processAdapter.execFile("netstat.exe", ["-ano"], { timeoutMs: 6000 });
    return parseNetstatListeningPids(result.stdout, port);
  }
  const result = await processAdapter.execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { timeoutMs: 6000 });
  return [...new Set(result.stdout.split(/\r?\n/).map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0))];
}

export function parseNetstatListeningPids(output: string, port: number): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0]?.toUpperCase() !== "TCP") continue;
    const localAddress = columns[1] ?? "";
    const state = columns[3] ?? "";
    const pid = Number(columns[4]);
    if (state.toUpperCase() === "LISTENING" && addressUsesPort(localAddress, port) && Number.isInteger(pid)) {
      pids.add(pid);
    }
  }
  return [...pids];
}

function addressUsesPort(address: string, port: number): boolean {
  return address.endsWith(`:${port}`) || address.endsWith(`]:${port}`);
}
