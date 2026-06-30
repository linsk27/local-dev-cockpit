import { createServer, type IncomingMessage } from "node:http";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";
import { ZodError } from "zod";
import { EventBus } from "./events.js";
import { resolveAppPaths } from "./paths.js";
import { ProcessManager } from "./process-manager.js";
import { ProjectScanCache } from "./services/project-scan-cache.js";
import { handleApiRoute, sendJson } from "./routes.js";
import { SkillRadarStore } from "./services/skill-radar/index.js";
import { JsonStore } from "./store.js";
import { listenOnAvailablePort } from "./services/http-listener.js";
import { serveStaticAsset } from "./services/static-assets.js";

export { commandStartBlockReason, commandSystemPortBlockReason } from "./services/command-guards.js";
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
  projectPortCanBeStopped,
  parseStoppedChildrenOutput,
  stopPort
} from "./services/port-control.js";
export type { StopPortResult } from "./services/port-control.js";

export {
  chooseProjectRootFolder,
  createEditorCommand,
  createFolderPickerCommand,
  createOpenFolderCommand,
  createWindowsStartProcessCommand,
  openProjectFolder,
  openProjectInEditor,
  parseEditorCommand,
  parseWindowsRegistryDefaultValue,
  resolveFolderPickerInitialPath,
  selectWindowsEditorExecutable,
  windowsGuiExecutableCandidateForShim
} from "./services/native-shell.js";
export type { FolderPickerCommand, FolderPickerResult } from "./services/native-shell.js";

const DEFAULT_APP_VERSION = readOwnPackageVersion("0.0.0");

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
  const skillRadar = new SkillRadarStore(paths);
  const webRoot = options.webRoot ? path.resolve(options.webRoot) : undefined;
  const currentVersion = options.version ?? DEFAULT_APP_VERSION;

  const server = createServer(async (req, res) => {
    try {
      const routeContext = { store, processManager, projectCache, skillRadar, currentVersion };
      const handledApi = await handleApiRoute(req, res, routeContext);
      if (handledApi) return;
      if (isApiRequest(req)) {
        sendJson(res, 404, { error: "API endpoint not found" });
        return;
      }
      await serveStaticAsset(req, res, webRoot);
    } catch (error) {
      if (isZodErrorLike(error)) {
        sendJson(res, 400, { error: formatValidationError(error) });
        return;
      }
      if (isHttpStatusError(error)) {
        sendJson(res, error.statusCode, error.body ?? { error: error.message });
        return;
      }
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

  const port = await listenOnAvailablePort(server, options.port ?? 8787);
  return {
    port,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
      wss.close();
    }
  };
}

function isZodErrorLike(error: unknown): error is ZodError {
  return error instanceof ZodError || (typeof error === "object" && error !== null && Array.isArray((error as { issues?: unknown }).issues));
}

function isHttpStatusError(error: unknown): error is Error & { statusCode: number; body?: unknown } {
  if (!(error instanceof Error)) return false;
  const statusCode = (error as Error & { statusCode?: unknown }).statusCode;
  return (
    typeof statusCode === "number" &&
    Number.isInteger(statusCode) &&
    statusCode >= 400 &&
    statusCode < 600
  );
}

function formatValidationError(error: ZodError): string {
  const firstIssue = error.issues[0];
  if (firstIssue?.message === "Paste a link or text first") return "请先粘贴链接或文本。";
  return firstIssue?.message || "Invalid request payload";
}

function isApiRequest(req: IncomingMessage): boolean {
  const url = new URL(req.url ?? "/", "http://localhost");
  return url.pathname === "/api" || url.pathname.startsWith("/api/");
}

function readOwnPackageVersion(fallback: string): string {
  try {
    const current = path.dirname(fileURLToPath(import.meta.url));
    const packageJson = JSON.parse(readFileSync(path.join(current, "..", "package.json"), "utf8")) as { version?: unknown };
    return typeof packageJson.version === "string" && packageJson.version.trim() ? packageJson.version.trim() : fallback;
  } catch {
    return fallback;
  }
}
