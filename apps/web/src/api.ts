import type { ProcessRun, Project, RecoveryCard } from "@local-dev-cockpit/core";

export interface ProjectsResponse {
  projects: Project[];
}

export interface ContextResponse {
  context: string;
  agents: string;
  recovery: RecoveryCard;
}

export interface RootEntry {
  id: string;
  path: string;
}

export interface AppConfig {
  roots: string[];
  ignoreNames: string[];
  editorCommand: string;
  projectEnvironments: Record<string, ProjectEnvironmentSettings>;
}

export interface ProjectEnvironmentSettings {
  python: string;
}

export interface PerformanceSnapshot {
  process: {
    pid: number;
    uptimeMs: number;
    rssMb: number;
    heapUsedMb: number;
    cpuPercent: number;
    cpuSingleCorePercent: number;
  };
  scan: {
    scope: string;
    status: "empty" | "cached" | "scanning" | "stale";
    cacheExpiresInMs: number;
    lastScanDurationMs: number;
    lastProjectCount: number;
    lastScannedAt?: string;
    cacheHits: number;
    cacheMisses: number;
    joinedRequests: number;
  };
  polling: {
    projectScanCacheTtlMs: number;
    externalPortOwnerCacheTtlMs: number;
  };
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

export interface StopProcessResponse {
  stopped: boolean;
  run?: ProcessRun;
}

export interface StopPortResponse {
  stopped: boolean;
  port: number;
  pids: number[];
  alreadyClosed?: boolean;
  error?: string;
}

export interface WriteContextResponse {
  files: string[];
}

export interface OpenFolderResponse {
  opened: true;
  path: string;
}

export interface FolderPickerResponse {
  canceled: boolean;
  path?: string;
}

export class RootFolderPickerUnavailableError extends Error {
  constructor(message = "Root folder picker endpoint is unavailable") {
    super(message);
    this.name = "RootFolderPickerUnavailableError";
  }
}

export interface OpenEditorResponse {
  opened: true;
  path: string;
  command: string;
}

export interface CommandEnvironmentDiagnostic {
  commandId: string;
  label: string;
  status: "ready" | "warn" | "missing";
  summary: string;
  detail: string;
  resolvedCommand?: string;
}

export interface PythonEnvironmentCandidate {
  id: string;
  label: string;
  value: string;
  source: "manual" | "vscode" | "local" | "conda-file" | "conda-list" | "terminal";
  detail: string;
}

export async function getProjects(options: { force?: boolean; rootId?: string } = {}): Promise<Project[]> {
  const params = new URLSearchParams();
  if (options.force) params.set("force", "1");
  if (options.rootId) params.set("rootId", options.rootId);
  const response = await fetch(`/api/projects${params.size > 0 ? `?${params.toString()}` : ""}`);
  await ensureOk(response, "Failed to load projects");
  return ((await response.json()) as ProjectsResponse).projects;
}

export async function getPerformance(options: { rootId?: string } = {}): Promise<PerformanceSnapshot> {
  const params = new URLSearchParams();
  if (options.rootId) params.set("rootId", options.rootId);
  const response = await fetch(`/api/performance${params.size > 0 ? `?${params.toString()}` : ""}`);
  await ensureOk(response, "Failed to load performance");
  return response.json() as Promise<PerformanceSnapshot>;
}

export async function checkUpdates(): Promise<UpdateCheckResult> {
  const response = await fetch("/api/update");
  await ensureOk(response, "Failed to check updates");
  return response.json() as Promise<UpdateCheckResult>;
}

export async function getProject(projectId: string): Promise<Project> {
  const response = await fetch(`/api/projects/${projectId}`);
  await ensureOk(response, "Failed to load project");
  return ((await response.json()) as { project: Project }).project;
}

export async function openProjectFolder(projectId: string): Promise<OpenFolderResponse> {
  const response = await fetch(`/api/projects/${projectId}/open-folder`, {
    method: "POST"
  });
  await ensureOk(response, "Failed to open project folder");
  return response.json() as Promise<OpenFolderResponse>;
}

export async function openProjectEditor(projectId: string): Promise<OpenEditorResponse> {
  const response = await fetch(`/api/projects/${projectId}/open-editor`, {
    method: "POST"
  });
  await ensureOk(response, "Failed to open project in editor");
  return response.json() as Promise<OpenEditorResponse>;
}

export async function startCommand(projectId: string, commandId: string) {
  const response = await fetch(`/api/projects/${projectId}/commands/${encodeURIComponent(commandId)}/start`, {
    method: "POST"
  });
  await ensureOk(response, "Failed to start command");
  return response.json() as Promise<{ run: ProcessRun }>;
}

export async function stopProcess(projectId: string, processId: string): Promise<StopProcessResponse> {
  const response = await fetch(`/api/projects/${projectId}/processes/${encodeURIComponent(processId)}/stop`, {
    method: "POST"
  });
  await ensureOk(response, "Failed to stop process");
  return response.json() as Promise<StopProcessResponse>;
}

export async function stopPort(projectId: string, port: number): Promise<StopPortResponse> {
  const response = await fetch(`/api/projects/${projectId}/ports/${port}/stop`, {
    method: "POST"
  });
  await ensureOk(response, "Failed to stop port");
  return response.json() as Promise<StopPortResponse>;
}

export async function getLogs(projectId: string, runId: string): Promise<string> {
  const response = await fetch(`/api/projects/${projectId}/logs?runId=${encodeURIComponent(runId)}`);
  await ensureOk(response, "Failed to load logs");
  return ((await response.json()) as { logs: string }).logs;
}

export async function getContext(projectId: string): Promise<ContextResponse> {
  const response = await fetch(`/api/projects/${projectId}/context`);
  await ensureOk(response, "Failed to load context");
  return response.json() as Promise<ContextResponse>;
}

export async function getEnvironmentDiagnostics(projectId: string): Promise<CommandEnvironmentDiagnostic[]> {
  const response = await fetch(`/api/projects/${projectId}/environment`);
  await ensureOk(response, "Failed to load environment diagnostics");
  return ((await response.json()) as { diagnostics: CommandEnvironmentDiagnostic[] }).diagnostics;
}

export async function getPythonEnvironmentCandidates(projectId: string): Promise<PythonEnvironmentCandidate[]> {
  const response = await fetch(`/api/projects/${projectId}/environment/candidates`);
  await ensureOk(response, "Failed to load Python environment candidates");
  return ((await response.json()) as { candidates: PythonEnvironmentCandidate[] }).candidates;
}

export async function getProjectSettings(projectId: string): Promise<ProjectEnvironmentSettings> {
  const response = await fetch(`/api/projects/${projectId}/settings`);
  await ensureOk(response, "Failed to load project settings");
  return ((await response.json()) as { environment: ProjectEnvironmentSettings }).environment;
}

export async function updateProjectEnvironment(projectId: string, environment: ProjectEnvironmentSettings): Promise<ProjectEnvironmentSettings> {
  const response = await fetch(`/api/projects/${projectId}/settings`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(environment)
  });
  await ensureOk(response, "Failed to update project settings");
  return ((await response.json()) as { environment: ProjectEnvironmentSettings }).environment;
}

export async function writeContext(projectId: string): Promise<WriteContextResponse> {
  const response = await fetch(`/api/projects/${projectId}/context/write`, {
    method: "POST"
  });
  await ensureOk(response, "Failed to write context files");
  return response.json() as Promise<WriteContextResponse>;
}

export async function addRoot(path: string) {
  const response = await fetch("/api/roots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path })
  });
  await ensureOk(response, "Failed to add root");
  return response.json();
}

export async function chooseRootFolder(initialPath?: string): Promise<FolderPickerResponse> {
  const response = await fetch("/api/dialogs/open-folder", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ initialPath: initialPath?.trim() ?? "" })
  });
  if (!response.ok) {
    const message = await readApiError(response, "Failed to choose folder");
    if (isMissingFolderPickerEndpoint(response, message)) {
      throw new RootFolderPickerUnavailableError(message);
    }
    throw new Error(message);
  }
  return response.json() as Promise<FolderPickerResponse>;
}

export async function getRoots(): Promise<RootEntry[]> {
  const response = await fetch("/api/roots");
  await ensureOk(response, "Failed to load roots");
  return ((await response.json()) as { roots: RootEntry[] }).roots;
}

export async function getConfig(): Promise<AppConfig> {
  const response = await fetch("/api/config");
  await ensureOk(response, "Failed to load config");
  return ((await response.json()) as { config: AppConfig }).config;
}

export async function updateConfig(config: Partial<Pick<AppConfig, "editorCommand">>): Promise<AppConfig> {
  const response = await fetch("/api/config", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(config)
  });
  await ensureOk(response, "Failed to update config");
  return ((await response.json()) as { config: AppConfig }).config;
}

export async function removeRoot(rootId: string): Promise<void> {
  const response = await fetch(`/api/roots/${encodeURIComponent(rootId)}`, {
    method: "DELETE"
  });
  await ensureOk(response, "Failed to remove root");
}

async function ensureOk(response: Response, fallback: string): Promise<void> {
  if (response.ok) return;
  throw new Error(await readApiError(response, fallback));
}

async function readApiError(response: Response, fallback: string): Promise<string> {
  const statusText = `${fallback}: ${response.status}`;
  const contentType = response.headers.get("content-type") ?? "";
  try {
    if (contentType.includes("application/json")) {
      const body = (await response.json()) as { error?: unknown };
      return typeof body.error === "string" && body.error.trim() ? body.error : statusText;
    }
    const text = await response.text();
    return text.trim() ? text.trim() : statusText;
  } catch {
    return statusText;
  }
}

function isMissingFolderPickerEndpoint(response: Response, message: string): boolean {
  return response.status === 404 || response.status === 405 || /Cannot\s+(POST|GET)|not\s+found|web assets not found/i.test(message);
}
