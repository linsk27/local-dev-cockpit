import type { ProcessRun, Project, RecoveryCard } from "./types.js";

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

export type ResourceKind =
  | "skill-md"
  | "github-repo"
  | "mcp"
  | "prompt"
  | "workflow"
  | "demo"
  | "tool"
  | "article"
  | "unknown";
export type ResourceStatus = "inbox" | "useful" | "archived";
export type ResourceAnalysisSource = "rules" | "metadata" | "ai" | "mixed";
export type ResourceTaxonomySource = "rules" | "ai" | "manual";
export type AiProviderId = "openai" | "rayinai" | "deepseek" | "siliconflow" | "openrouter" | "ollama" | "custom";
export type AiOutputLocale = "zh-CN" | "en-US" | "source";
export type ResourceLanguage = "zh-CN" | "en-US" | "mixed" | "unknown";

export interface ResourceMetadata {
  title?: string;
  description?: string;
  siteName?: string;
  fetchedUrl?: string;
  imageUrl?: string;
  iconUrl?: string;
  images?: Array<{ label: string; url: string; source?: "og" | "twitter" | "readme" | "page" | "icon" | "github-open-graph" }>;
  textSample?: string;
  links?: Array<{ label: string; url: string }>;
  repository?: {
    owner?: string;
    name?: string;
    fullName?: string;
    description?: string;
    language?: string;
    stars?: number;
    forks?: number;
    topics?: string[];
    homepage?: string;
    license?: string;
    defaultBranch?: string;
    pushedAt?: string;
  };
  [key: string]: unknown;
}

export interface RadarItem {
  id: string;
  title: string;
  sourceUrl?: string;
  sourceText?: string;
  kind: ResourceKind;
  category: string;
  categoryPath?: string[];
  taxonomySource?: ResourceTaxonomySource;
  tags: string[];
  status: ResourceStatus;
  confidence: number;
  summary: string;
  highlights?: string[];
  useCases?: string[];
  evidence?: string[];
  previewImageUrl?: string;
  createdAt: string;
  updatedAt: string;
  analysisSource?: ResourceAnalysisSource;
  sourceFetchedAt?: string;
  analysisError?: string;
  language?: ResourceLanguage;
  outputLocale?: AiOutputLocale;
  rawMetadata?: ResourceMetadata;
}

export type SkillKind = ResourceKind;
export type SkillStatus = ResourceStatus;
export type SkillItem = RadarItem;

export interface ResourceCreateInput {
  sourceUrl?: string;
  sourceText?: string;
  outputLocale?: AiOutputLocale;
}

export interface ResourceAiConfig {
  provider: "openai-compatible";
  providerId: AiProviderId;
  baseUrl: string;
  model: string;
  outputLocale: AiOutputLocale;
  hasApiKey: boolean;
  source: "env" | "local" | "none";
}

export interface AiProviderPreset {
  label: string;
  baseUrl: string;
  model: string;
}

export type AiProviderPresets = Record<AiProviderId, AiProviderPreset>;

export interface ResourceAiConfigUpdate {
  providerId?: AiProviderId;
  baseUrl?: string;
  model?: string;
  outputLocale?: AiOutputLocale;
  apiKey?: string;
  clearApiKey?: boolean;
}

export interface ResourceAiConfigPayload {
  config: ResourceAiConfig;
  providers: AiProviderPresets;
}

export interface ResourceAiTestResult {
  ok: boolean;
  providerId: string;
  baseUrl: string;
  model: string;
  latencyMs: number;
  error?: string;
}

export type SkillCreateInput = ResourceCreateInput;
export type ResourceUpdateInput = Partial<Pick<RadarItem, "title" | "summary" | "category" | "categoryPath" | "taxonomySource" | "tags" | "status">>;
export type SkillUpdateInput = ResourceUpdateInput;

export interface ResourceExportPayload {
  app: "dev-cockpit-resource-radar";
  version: number;
  exportedAt?: string;
  items: RadarItem[];
}

export interface ResourceImportResult {
  added: number;
  skipped: number;
  failed?: number;
  total: number;
  items: RadarItem[];
}

export interface ResourceSummary {
  total: number;
  updatedAt?: string;
  statuses: Record<string, number>;
  kinds: Record<string, number>;
  categories: Array<{ major: string; count: number; children: Array<{ minor: string; count: number }> }>;
}
