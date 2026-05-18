import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
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
  type PortStatus,
  type ProcessRun,
  type Project
} from "@local-dev-cockpit/core";
import { EventBus } from "./events.js";
import { stripAnsiControlSequences } from "./log-decoder.js";
import { resolveAppPaths } from "./paths.js";
import { ProcessManager } from "./process-manager.js";
import { JsonStore, rootId } from "./store.js";

const addRootSchema = z.object({ path: z.string().min(1) });

export interface DevCockpitServerOptions {
  cwd?: string;
  port?: number;
  webRoot?: string;
}

export interface RunningServer {
  port: number;
  close(): Promise<void>;
}

export async function startDevCockpitServer(options: DevCockpitServerOptions = {}): Promise<RunningServer> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const paths = resolveAppPaths();
  const store = new JsonStore(paths, cwd);
  await store.ensure();
  const eventBus = new EventBus();
  const processManager = new ProcessManager(paths, store, eventBus);
  const webRoot = options.webRoot ? path.resolve(options.webRoot) : undefined;

  const server = createServer(async (req, res) => {
    try {
      await route(req, res, { store, processManager, webRoot });
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
  context: { store: JsonStore; processManager: ProcessManager; webRoot?: string }
): Promise<void> {
  const url = new URL(req.url ?? "/", "http://localhost");
  const method = req.method ?? "GET";

  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, name: "Dev Cockpit" });
    return;
  }

  if (method === "GET" && url.pathname === "/api/projects") {
    const projects = await loadProjects(context.store, context.processManager);
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

  if (method === "POST" && url.pathname === "/api/roots") {
    const body = addRootSchema.parse(await readJson(req));
    const config = await context.store.addRoot(body.path);
    sendJson(res, 200, { config });
    return;
  }

  const rootDelete = url.pathname.match(/^\/api\/roots\/([^/]+)$/);
  if (method === "DELETE" && rootDelete) {
    const config = await context.store.removeRoot(rootDelete[1] ?? "");
    sendJson(res, 200, { config });
    return;
  }

  const projectMatch = url.pathname.match(/^\/api\/projects\/([^/]+)$/);
  if (method === "GET" && projectMatch) {
    const project = await loadProject(projectMatch[1] ?? "", context.store, context.processManager);
    sendJson(res, 200, { project });
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
    const run = await context.processManager.start(project.id, command);
    sendJson(res, 200, { run });
    return;
  }

  const stopMatch = url.pathname.match(/^\/api\/projects\/([^/]+)\/processes\/([^/]+)\/stop$/);
  if (method === "POST" && stopMatch) {
    const projectId = decodeURIComponent(stopMatch[1] ?? "");
    const runId = decodeURIComponent(stopMatch[2] ?? "");
    const stoppedRun = await context.processManager.stop(runId);
    if (stoppedRun) {
      sendJson(res, 200, { stopped: true, run: stoppedRun });
      return;
    }
    const staleRun = await context.store.markRunStopped(projectId, runId);
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

  await serveStatic(req, res, context.webRoot);
}

async function loadProjects(store: JsonStore, processManager: ProcessManager): Promise<Project[]> {
  const config = await store.readConfig();
  const state = await store.readState();
  const projects: Project[] = [];

  for (const root of config.roots) {
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

async function enrichProject(
  project: Project,
  lastRun: ProcessRun | undefined,
  lastError: ErrorSummary | undefined,
  processManager: ProcessManager,
  enrichment: EnrichmentContext
): Promise<Project> {
  const managedRun = normalizeManagedRun(lastRun, processManager);
  const processPorts = managedRun
    ? await extractPortsFromLogs(await processManager.readLogs(managedRun.id), managedRun.status, project.path)
    : [];
  const externalPorts = findExternalProjectPorts(project, enrichment.externalPortOwnersByProject.get(project.id) ?? []);
  const scannedPorts = normalizeScannedPorts(project, externalPorts, enrichment.detectedPortCounts);
  const currentRun = hydrateLastRun(managedRun, processPorts);
  const currentError = isStaleError(currentRun, lastError) ? undefined : lastError;

  return {
    ...project,
    ports: mergePorts([...scannedPorts, ...externalPorts], processPorts),
    lastRun: currentRun,
    lastError: currentError
  };
}

interface EnrichmentContext {
  externalPortOwnersByProject: Map<string, ExternalPortOwner[]>;
  detectedPortCounts: Map<number, number>;
}

export interface ExternalPortOwner {
  port: number;
  host?: string;
  pid: number;
  commandLine: string;
}

async function createEnrichmentContext(projects: Project[]): Promise<EnrichmentContext> {
  const externalPortOwners = await detectExternalPortOwners(new NodeProcessAdapter());
  return {
    externalPortOwnersByProject: assignExternalPortOwners(projects, externalPortOwners),
    detectedPortCounts: countDetectedPortOwners(projects)
  };
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
 * trusted if the OS process command line references this project, or if this is
 * the only scanned project declaring that port. Otherwise it is treated like a
 * common probe and stays hidden from the dashboard's online status.
 */
function normalizeScannedPorts(project: Project, externalPorts: PortStatus[], detectedPortCounts: Map<number, number>): PortStatus[] {
  const externallyMatched = new Set(externalPorts.map((port) => port.port));
  return project.ports.map((port) => {
    if (port.source !== "detected" || port.status !== "open") return port;
    if (externallyMatched.has(port.port) || (detectedPortCounts.get(port.port) ?? 0) <= 1) return port;
    return { ...port, source: "common" };
  });
}

function findExternalProjectPorts(project: Project, owners: ExternalPortOwner[]): PortStatus[] {
  const ports = new Map<string, PortStatus>();
  for (const owner of owners) {
    if (!commandLineReferencesProject(owner.commandLine, project.path)) continue;
    const host = normalizeExternalHost(owner.host);
    const endpoint: PortStatus = {
      port: owner.port,
      host,
      url: formatLocalUrl(owner.port, host),
      status: "open",
      source: "detected"
    };
    ports.set(portKey(endpoint), endpoint);
  }
  return [...ports.values()];
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

function normalizeExternalHost(host: string | undefined): string {
  const normalized = normalizePortHost(host ?? "localhost");
  if (normalized === "127.0.0.1" || normalized === "0.0.0.0") return "localhost";
  if (normalized === "::") return "::1";
  return normalized || "localhost";
}

function formatLocalUrl(port: number, host: string): string {
  return `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
}

async function isEndpointOpen(processAdapter: NodeProcessAdapter, endpoint: Pick<PortStatus, "port" | "host">): Promise<boolean> {
  if (!endpoint.host || endpoint.host === "localhost") return processAdapter.isPortOpen(endpoint.port);
  return processAdapter.isPortOpen(endpoint.port, endpoint.host);
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

interface StopPortResult {
  stopped: boolean;
  port: number;
  pids: number[];
  error?: string;
}

async function stopPort(port: number): Promise<StopPortResult> {
  const processAdapter = new NodeProcessAdapter();
  const pids = await findListeningPidsByPort(processAdapter, port);
  const killablePids = pids.filter((pid) => pid > 0 && pid !== process.pid);
  if (killablePids.length === 0) {
    return { stopped: false, port, pids, error: pids.includes(process.pid) ? "Refusing to stop Dev Cockpit itself" : "No process found for port" };
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
  return {
    stopped: failures.length === 0 && !stillOpen,
    port,
    pids: killablePids,
    error:
      failures.length > 0
        ? failures.join("\n")
        : stillOpen
          ? [...actions, "端口仍在监听。父进程可能不可见或由系统代理托管，请关闭启动它的终端，或用管理员权限重新运行 Dev Cockpit。"].join("\n")
          : undefined
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
