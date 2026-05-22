import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { promises as fs } from "node:fs";
import path from "node:path";
import { WebSocketServer } from "ws";
import { EventBus } from "./events.js";
import { resolveAppPaths } from "./paths.js";
import { ProcessManager } from "./process-manager.js";
import { ApiLensRecorder } from "./services/api-lens/index.js";
import { ProjectScanCache } from "./services/project-scan-cache.js";
import { handleApiLensProxyRoute, handleApiRoute, sendJson } from "./routes.js";
import { JsonStore } from "./store.js";

export { commandStartBlockReason } from "./services/command-guards.js";
export { writeProjectContextFiles } from "./services/context-files.js";
export {
  assignExternalPortOwners,
  commandLineReferencesProject,
  externalListenerProbeCandidates,
  filterStaleLogPorts,
  findExternalProjectPorts,
  isLocalHttpEndpointReachable,
  isObsoleteMissingToolFailure,
  logIndicatesExistingServer,
  normalizeScannedPorts,
  parseExternalPortOwners,
  parseLocalEndpointsFromLogs,
  parseMissingToolName
} from "./services/port-status.js";
export type { ExternalPortOwner } from "./services/port-status.js";

export {
  checkForUpdates,
  formatUpdateCheckError,
  isNewerVersion,
  parseNpmLatest,
  selectUpdateAssets
} from "./services/update-checker.js";
export type { ReleaseAssetSummary, UpdateCheckResult } from "./services/update-checker.js";

export {
  parseNetstatListeningPids,
  parseStoppedChildrenOutput,
  stopPort
} from "./services/port-control.js";
export type { StopPortResult } from "./services/port-control.js";

export {
  chooseProjectRootFolder,
  createEditorCommand,
  createFolderPickerCommand,
  createOpenFolderCommand,
  openProjectFolder,
  openProjectInEditor,
  parseEditorCommand,
  resolveFolderPickerInitialPath
} from "./services/native-shell.js";
export type { FolderPickerCommand, FolderPickerResult } from "./services/native-shell.js";

const DEFAULT_APP_VERSION = "0.2.0";

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

export async function startDevCockpitServer(options: DevCockpitServerOptions = {}): Promise<RunningServer> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
  const paths = resolveAppPaths();
  const store = new JsonStore(paths, cwd);
  await store.ensure();
  const eventBus = new EventBus();
  const processManager = new ProcessManager(paths, store, eventBus);
  const projectCache = new ProjectScanCache();
  const apiLensRecorder = new ApiLensRecorder();
  const webRoot = options.webRoot ? path.resolve(options.webRoot) : undefined;
  const currentVersion = options.version ?? DEFAULT_APP_VERSION;

  const server = createServer(async (req, res) => {
    try {
      const routeContext = { store, processManager, projectCache, apiLensRecorder, currentVersion };
      const handledApi = await handleApiRoute(req, res, routeContext);
      if (handledApi) return;
      const handledLens = await handleApiLensProxyRoute(req, res, routeContext);
      if (handledLens) return;
      await serveStatic(req, res, webRoot);
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
