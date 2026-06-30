import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import { aiOutputLocaleSchema, aiProviderIdSchema, type ErrorSummary, type ProcessRun } from "@local-dev-cockpit/core";
import type { AppPaths } from "./paths.js";
import { FileOperationQueue } from "./services/file-operation-queue.js";
import { readJsonFile, writeJsonAtomic } from "./services/json-file.js";
import { migrateVersionedJson } from "./services/json-migrations.js";

const projectEnvironmentSchema = z.object({
  python: z.string().default("")
});

const DEFAULT_AI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_AI_MODEL = "gpt-4o-mini";
const DEFAULT_AI_PROVIDER_ID = "rayinai";
const DEFAULT_AI_OUTPUT_LOCALE = "zh-CN";

const aiSettingsSchema = z.object({
  provider: z.literal("openai-compatible").default("openai-compatible"),
  providerId: aiProviderIdSchema.default(DEFAULT_AI_PROVIDER_ID),
  baseUrl: z.string().default(DEFAULT_AI_BASE_URL),
  model: z.string().default(DEFAULT_AI_MODEL),
  outputLocale: aiOutputLocaleSchema.default(DEFAULT_AI_OUTPUT_LOCALE),
  apiKey: z.string().default("")
});

const configSchema = z.object({
  roots: z.array(z.string()).default([]),
  ignoreNames: z.array(z.string()).default([]),
  editorCommand: z.string().default("code"),
  projectEnvironments: z.record(projectEnvironmentSchema).default({})
});

const STATE_VERSION = 1;

const processRunSchema = z.object({
  id: z.string(),
  projectId: z.string(),
  commandId: z.string(),
  status: z.enum(["running", "exited", "failed", "stopped"]),
  startedAt: z.string(),
  exitedAt: z.string().optional(),
  exitCode: z.number().int().optional(),
  logPath: z.string()
});

const errorSummarySchema = z.object({
  message: z.string(),
  commandId: z.string().optional(),
  occurredAt: z.string()
});

const stateFileSchema = z.object({
  version: z.number().int().default(STATE_VERSION),
  runs: z.record(z.string(), z.unknown()).default({}),
  errors: z.record(z.string(), z.unknown()).default({})
});

export type AppConfig = z.infer<typeof configSchema>;
export type AiSettings = z.infer<typeof aiSettingsSchema>;

export interface PublicAiSettings {
  provider: "openai-compatible";
  providerId: AiProviderId;
  baseUrl: string;
  model: string;
  outputLocale: AiOutputLocale;
  hasApiKey: boolean;
  source: "env" | "local" | "none";
}

export type AiProviderId = z.infer<typeof aiProviderIdSchema>;
export type AiOutputLocale = z.infer<typeof aiOutputLocaleSchema>;

export interface AiSettingsUpdate {
  providerId?: AiProviderId;
  baseUrl?: string;
  model?: string;
  outputLocale?: AiOutputLocale;
  apiKey?: string;
  clearApiKey?: boolean;
}

interface AppState {
  runs: Record<string, ProcessRun>;
  errors: Record<string, ErrorSummary>;
}

export class JsonStore {
  private readonly aiSettingsQueue = new FileOperationQueue();
  private readonly configQueue = new FileOperationQueue();
  private readonly stateQueue = new FileOperationQueue();

  constructor(private readonly paths: AppPaths, _cwd: string) {}

  async ensure(): Promise<void> {
    await fs.mkdir(this.paths.dataDir, { recursive: true });
    await fs.mkdir(this.paths.logsDir, { recursive: true });
    if (!(await exists(this.paths.configPath))) {
      await this.writeConfig(defaultConfig());
    }
    if (!(await exists(this.paths.statePath))) {
      await this.writeState({ runs: {}, errors: {} });
    }
  }

  async readConfig(): Promise<AppConfig> {
    await this.ensure();
    return this.readConfigFile();
  }

  private async readConfigFile(): Promise<AppConfig> {
    return readJsonFile(
      this.paths.configPath,
      (value) => {
        const parsed = configSchema.safeParse(value);
        return parsed.success ? parsed.data : defaultConfig();
      },
      defaultConfig
    );
  }

  async writeConfig(config: AppConfig): Promise<void> {
    await this.configQueue.run(() => writeJsonAtomic(this.paths.configPath, config));
  }

  async addRoot(root: string): Promise<AppConfig> {
    const sanitized = sanitizePathInput(root);
    if (!sanitized) throw new Error("Root path is empty");
    const resolved = path.resolve(sanitized);
    await this.ensure();
    return this.configQueue.run(async () => {
      const config = await this.readConfigFile();
      if (!config.roots.includes(resolved)) {
        config.roots.push(resolved);
      }
      await writeJsonAtomic(this.paths.configPath, config);
      return config;
    });
  }

  async updateProjectEnvironment(projectPath: string, python: string): Promise<AppConfig> {
    const normalizedPath = path.resolve(sanitizePathInput(projectPath));
    const sanitizedPython = sanitizeEnvironmentInput(python);
    await this.ensure();
    return this.configQueue.run(async () => {
      const config = await this.readConfigFile();
      if (sanitizedPython) {
        config.projectEnvironments[normalizedPath] = { python: sanitizedPython };
      } else {
        delete config.projectEnvironments[normalizedPath];
      }
      await writeJsonAtomic(this.paths.configPath, config);
      return config;
    });
  }

  async removeRoot(id: string): Promise<AppConfig> {
    await this.ensure();
    return this.configQueue.run(async () => {
      const config = await this.readConfigFile();
      config.roots = config.roots.filter((root) => rootId(root) !== id);
      await writeJsonAtomic(this.paths.configPath, config);
      return config;
    });
  }

  async updateEditorCommand(editorCommand: string): Promise<AppConfig> {
    const sanitized = sanitizeCommandInput(editorCommand);
    if (!sanitized) throw new Error("Editor command is empty");
    await this.ensure();
    return this.configQueue.run(async () => {
      const config = await this.readConfigFile();
      config.editorCommand = sanitized;
      await writeJsonAtomic(this.paths.configPath, config);
      return config;
    });
  }

  async readAiSettings(): Promise<AiSettings> {
    await this.ensure();
    return this.readAiSettingsFile();
  }

  private async readAiSettingsFile(): Promise<AiSettings> {
    return readJsonFile(
      this.aiSettingsPath(),
      (value) => {
        const parsed = aiSettingsSchema.safeParse(value);
        return parsed.success ? parsed.data : defaultAiSettings();
      },
      defaultAiSettings
    );
  }

  async updateAiSettings(input: AiSettingsUpdate): Promise<AiSettings> {
    await this.ensure();
    return this.aiSettingsQueue.run(async () => {
      const current = await this.readAiSettingsFile();
      const next = applyAiSettingsUpdate(current, input);
      await writeJsonAtomic(this.aiSettingsPath(), next);
      return next;
    });
  }

  async previewAiSettings(input: AiSettingsUpdate): Promise<AiSettings> {
    return applyAiSettingsUpdate(await this.readAiSettings(), input);
  }

  async readState(): Promise<AppState> {
    await this.ensure();
    return this.readStateFile();
  }

  private async readStateFile(): Promise<AppState> {
    return readJsonFile(
      this.paths.statePath,
      (value) => {
        const parsed = stateFileSchema.safeParse(migrateVersionedJson(value, STATE_VERSION));
        if (!parsed.success) return defaultState();
        return {
          runs: parseRecord(parsed.data.runs, processRunSchema),
          errors: parseRecord(parsed.data.errors, errorSummarySchema)
        };
      },
      defaultState
    );
  }

  async recordRun(run: ProcessRun): Promise<void> {
    await this.ensure();
    await this.stateQueue.run(async () => {
      const state = await this.readStateFile();
      state.runs[run.projectId] = run;
      if (run.status !== "failed") {
        delete state.errors[run.projectId];
      }
      await this.writeStateFile(state);
    });
  }

  async markRunStopped(projectId: string, runId: string): Promise<ProcessRun | undefined> {
    await this.ensure();
    return this.stateQueue.run(async () => {
      const state = await this.readStateFile();
      const run = state.runs[projectId];
      if (!run || run.id !== runId) return undefined;
      const stoppedRun: ProcessRun = {
        ...run,
        status: "stopped",
        exitedAt: run.exitedAt ?? new Date().toISOString()
      };
      state.runs[projectId] = stoppedRun;
      await this.writeStateFile(state);
      return stoppedRun;
    });
  }

  async clearError(projectId: string): Promise<void> {
    await this.ensure();
    await this.stateQueue.run(async () => {
      const state = await this.readStateFile();
      delete state.errors[projectId];
      await this.writeStateFile(state);
    });
  }

  async recordError(projectId: string, error: ErrorSummary): Promise<void> {
    await this.ensure();
    await this.stateQueue.run(async () => {
      const state = await this.readStateFile();
      state.errors[projectId] = error;
      await this.writeStateFile(state);
    });
  }

  private async writeState(state: AppState): Promise<void> {
    await this.stateQueue.run(() => this.writeStateFile(state));
  }

  private async writeStateFile(state: AppState): Promise<void> {
    await writeJsonAtomic(this.paths.statePath, { version: STATE_VERSION, ...state });
  }

  private aiSettingsPath(): string {
    return path.join(this.paths.dataDir, "ai-settings.json");
  }
}

function defaultConfig(): AppConfig {
  return { roots: [], ignoreNames: [], editorCommand: "code", projectEnvironments: {} };
}

function defaultState(): AppState {
  return { runs: {}, errors: {} };
}

function defaultAiSettings(): AiSettings {
  const preset = AI_PROVIDER_PRESETS[DEFAULT_AI_PROVIDER_ID];
  return {
    provider: "openai-compatible",
    providerId: DEFAULT_AI_PROVIDER_ID,
    baseUrl: preset.baseUrl,
    model: preset.model,
    outputLocale: DEFAULT_AI_OUTPUT_LOCALE,
    apiKey: ""
  };
}

export function toPublicAiSettings(settings: AiSettings): PublicAiSettings {
  const envProviderId = parseAiProviderId(process.env.DEV_COCKPIT_AI_PROVIDER_ID);
  const envApiKey = process.env.DEV_COCKPIT_AI_API_KEY?.trim();
  const envBaseUrl = process.env.DEV_COCKPIT_AI_BASE_URL?.trim();
  const envModel = process.env.DEV_COCKPIT_AI_MODEL?.trim();
  return {
    provider: "openai-compatible",
    providerId: envProviderId || settings.providerId || DEFAULT_AI_PROVIDER_ID,
    baseUrl: envBaseUrl || settings.baseUrl || DEFAULT_AI_BASE_URL,
    model: envModel || settings.model || DEFAULT_AI_MODEL,
    outputLocale: settings.outputLocale || DEFAULT_AI_OUTPUT_LOCALE,
    hasApiKey: Boolean(envApiKey || settings.apiKey),
    source: envApiKey ? "env" : settings.apiKey ? "local" : "none"
  };
}

function parseRecord<T>(raw: Record<string, unknown>, schema: z.ZodType<T>): Record<string, T> {
  const parsed: Record<string, T> = {};
  for (const [key, value] of Object.entries(raw)) {
    const result = schema.safeParse(value);
    if (result.success) parsed[key] = result.data;
  }
  return parsed;
}

export function rootId(root: string): string {
  return Buffer.from(root, "utf8").toString("base64url");
}

/**
 * Paths pasted from browsers, chats, or rich text editors can contain hidden
 * bidi/zero-width characters before the drive letter. Strip them before
 * resolving so Windows absolute paths stay absolute.
 */
export function sanitizePathInput(input: string): string {
  const cleaned = input
    .normalize("NFKC")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .trim();
  const unwrapped = cleaned.replace(/^["'`]+|["'`]+$/g, "").trim();
  const drivePath = unwrapped.match(/^[^\w\\/]*([A-Za-z]:[\\/].*)$/);
  return drivePath?.[1] ?? unwrapped;
}

export function sanitizeCommandInput(input: string): string {
  return input
    .normalize("NFKC")
    .replace(/[\u200E\u200F\u202A-\u202E\u2066-\u2069\uFEFF]/g, "")
    .trim();
}

export function sanitizeEnvironmentInput(input: string): string {
  return sanitizeCommandInput(input).replace(/^["'`]+|["'`]+$/g, "").trim();
}

function sanitizeAiConfigInput(input: string): string {
  return sanitizeCommandInput(input).replace(/\/+$/g, "");
}

export const AI_PROVIDER_PRESETS: Record<AiProviderId, { label: string; baseUrl: string; model: string }> = {
  openai: { label: "OpenAI", baseUrl: "https://api.openai.com/v1", model: "gpt-4o-mini" },
  rayinai: { label: "RayinAI / Custom Gateway", baseUrl: "https://code.rayinai.com/v1", model: "gpt-5.4" },
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com/v1", model: "deepseek-chat" },
  siliconflow: { label: "SiliconFlow", baseUrl: "https://api.siliconflow.cn/v1", model: "Qwen/Qwen2.5-72B-Instruct" },
  openrouter: { label: "OpenRouter", baseUrl: "https://openrouter.ai/api/v1", model: "openai/gpt-4o-mini" },
  ollama: { label: "Ollama Local", baseUrl: "http://127.0.0.1:11434/v1", model: "llama3.1" },
  custom: { label: "Custom OpenAI-compatible", baseUrl: DEFAULT_AI_BASE_URL, model: DEFAULT_AI_MODEL }
};

function applyAiSettingsUpdate(current: AiSettings, input: AiSettingsUpdate): AiSettings {
  return {
    provider: "openai-compatible",
    providerId: input.providerId ?? current.providerId ?? DEFAULT_AI_PROVIDER_ID,
    baseUrl: input.baseUrl !== undefined ? sanitizeAiConfigInput(input.baseUrl) || DEFAULT_AI_BASE_URL : current.baseUrl,
    model: input.model !== undefined ? sanitizeAiConfigInput(input.model) || DEFAULT_AI_MODEL : current.model,
    outputLocale: input.outputLocale ?? current.outputLocale ?? DEFAULT_AI_OUTPUT_LOCALE,
    apiKey:
      input.clearApiKey === true
        ? ""
        : input.apiKey !== undefined && input.apiKey.trim().length > 0
          ? input.apiKey.trim()
          : current.apiKey
  };
}

function parseAiProviderId(value: string | undefined): AiProviderId | undefined {
  if (!value) return undefined;
  const parsed = aiProviderIdSchema.safeParse(value.trim());
  return parsed.success ? parsed.data : undefined;
}

export function projectEnvironmentForPath(config: AppConfig, projectPath: string): { python?: string } | undefined {
  const resolved = path.resolve(projectPath);
  return config.projectEnvironments[resolved];
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
