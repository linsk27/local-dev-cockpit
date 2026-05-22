import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ErrorSummary, ProcessRun } from "@local-dev-cockpit/core";
import type { AppPaths } from "./paths.js";

const projectEnvironmentSchema = z.object({
  python: z.string().default("")
});

const apiLensTargetSchema = z.object({
  id: z.string(),
  name: z.string(),
  baseUrl: z.string(),
  projectId: z.string().optional(),
  createdAt: z.string()
});

const apiLensSchema = z.object({
  targets: z.array(apiLensTargetSchema).default([])
});

const configSchema = z.object({
  roots: z.array(z.string()).default([]),
  ignoreNames: z.array(z.string()).default([]),
  editorCommand: z.string().default("code"),
  projectEnvironments: z.record(projectEnvironmentSchema).default({}),
  apiLens: apiLensSchema.default({ targets: [] })
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

interface AppState {
  runs: Record<string, ProcessRun>;
  errors: Record<string, ErrorSummary>;
}

export class JsonStore {
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
    try {
      const parsed = configSchema.safeParse(JSON.parse(await fs.readFile(this.paths.configPath, "utf8")));
      return parsed.success ? parsed.data : defaultConfig();
    } catch {
      return defaultConfig();
    }
  }

  async writeConfig(config: AppConfig): Promise<void> {
    await writeJsonAtomic(this.paths.configPath, config);
  }

  async addRoot(root: string): Promise<AppConfig> {
    const config = await this.readConfig();
    const sanitized = sanitizePathInput(root);
    if (!sanitized) throw new Error("Root path is empty");
    const resolved = path.resolve(sanitized);
    if (!config.roots.includes(resolved)) {
      config.roots.push(resolved);
    }
    await this.writeConfig(config);
    return config;
  }

  async updateProjectEnvironment(projectPath: string, python: string): Promise<AppConfig> {
    const config = await this.readConfig();
    const normalizedPath = path.resolve(sanitizePathInput(projectPath));
    const sanitizedPython = sanitizeEnvironmentInput(python);
    if (sanitizedPython) {
      config.projectEnvironments[normalizedPath] = { python: sanitizedPython };
    } else {
      delete config.projectEnvironments[normalizedPath];
    }
    await this.writeConfig(config);
    return config;
  }

  async removeRoot(id: string): Promise<AppConfig> {
    const config = await this.readConfig();
    config.roots = config.roots.filter((root) => rootId(root) !== id);
    await this.writeConfig(config);
    return config;
  }

  async updateEditorCommand(editorCommand: string): Promise<AppConfig> {
    const sanitized = sanitizeCommandInput(editorCommand);
    if (!sanitized) throw new Error("Editor command is empty");
    const config = await this.readConfig();
    config.editorCommand = sanitized;
    await this.writeConfig(config);
    return config;
  }

  async readState(): Promise<AppState> {
    await this.ensure();
    try {
      const parsed = stateFileSchema.safeParse(JSON.parse(await fs.readFile(this.paths.statePath, "utf8")));
      if (!parsed.success) return defaultState();
      return {
        runs: parseRecord(parsed.data.runs, processRunSchema),
        errors: parseRecord(parsed.data.errors, errorSummarySchema)
      };
    } catch {
      return defaultState();
    }
  }

  async recordRun(run: ProcessRun): Promise<void> {
    const state = await this.readState();
    state.runs[run.projectId] = run;
    if (run.status !== "failed") {
      delete state.errors[run.projectId];
    }
    await this.writeState(state);
  }

  async markRunStopped(projectId: string, runId: string): Promise<ProcessRun | undefined> {
    const state = await this.readState();
    const run = state.runs[projectId];
    if (!run || run.id !== runId) return undefined;
    const stoppedRun: ProcessRun = {
      ...run,
      status: "stopped",
      exitedAt: run.exitedAt ?? new Date().toISOString()
    };
    state.runs[projectId] = stoppedRun;
    await this.writeState(state);
    return stoppedRun;
  }

  async clearError(projectId: string): Promise<void> {
    const state = await this.readState();
    delete state.errors[projectId];
    await this.writeState(state);
  }

  async recordError(projectId: string, error: ErrorSummary): Promise<void> {
    const state = await this.readState();
    state.errors[projectId] = error;
    await this.writeState(state);
  }

  private async writeState(state: AppState): Promise<void> {
    await writeJsonAtomic(this.paths.statePath, { version: STATE_VERSION, ...state });
  }
}

function defaultConfig(): AppConfig {
  return { roots: [], ignoreNames: [], editorCommand: "code", projectEnvironments: {}, apiLens: { targets: [] } };
}

function defaultState(): AppState {
  return { runs: {}, errors: {} };
}

async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await fs.rename(tempPath, filePath);
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
