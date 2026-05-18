import { promises as fs } from "node:fs";
import path from "node:path";
import { z } from "zod";
import type { ErrorSummary, ProcessRun } from "@local-dev-cockpit/core";
import type { AppPaths } from "./paths.js";

const configSchema = z.object({
  roots: z.array(z.string()).default([]),
  ignoreNames: z.array(z.string()).default([]),
  editorCommand: z.string().default("code")
});

const stateSchema = z.object({
  runs: z.record(z.string(), z.any()).default({}),
  errors: z.record(z.string(), z.any()).default({})
});

export type AppConfig = z.infer<typeof configSchema>;

interface AppState {
  runs: Record<string, ProcessRun>;
  errors: Record<string, ErrorSummary>;
}

export class JsonStore {
  constructor(private readonly paths: AppPaths, private readonly cwd: string) {}

  async ensure(): Promise<void> {
    await fs.mkdir(this.paths.dataDir, { recursive: true });
    await fs.mkdir(this.paths.logsDir, { recursive: true });
    if (!(await exists(this.paths.configPath))) {
      await this.writeConfig({ roots: [this.cwd], ignoreNames: [], editorCommand: "code" });
    }
    if (!(await exists(this.paths.statePath))) {
      await this.writeState({ runs: {}, errors: {} });
    }
  }

  async readConfig(): Promise<AppConfig> {
    await this.ensure();
    const parsed = configSchema.safeParse(JSON.parse(await fs.readFile(this.paths.configPath, "utf8")));
    return parsed.success ? parsed.data : { roots: [this.cwd], ignoreNames: [], editorCommand: "code" };
  }

  async writeConfig(config: AppConfig): Promise<void> {
    await fs.mkdir(path.dirname(this.paths.configPath), { recursive: true });
    await fs.writeFile(this.paths.configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  }

  async addRoot(root: string): Promise<AppConfig> {
    const config = await this.readConfig();
    const resolved = path.resolve(root);
    if (!config.roots.includes(resolved)) {
      config.roots.push(resolved);
    }
    await this.writeConfig(config);
    return config;
  }

  async removeRoot(id: string): Promise<AppConfig> {
    const config = await this.readConfig();
    config.roots = config.roots.filter((root) => Buffer.from(root, "utf8").toString("base64url") !== id);
    await this.writeConfig(config);
    return config;
  }

  async readState(): Promise<AppState> {
    await this.ensure();
    const parsed = stateSchema.safeParse(JSON.parse(await fs.readFile(this.paths.statePath, "utf8")));
    return parsed.success ? (parsed.data as AppState) : { runs: {}, errors: {} };
  }

  async recordRun(run: ProcessRun): Promise<void> {
    const state = await this.readState();
    state.runs[run.projectId] = run;
    if (run.status !== "failed") {
      delete state.errors[run.projectId];
    }
    await this.writeState(state);
  }

  async recordError(projectId: string, error: ErrorSummary): Promise<void> {
    const state = await this.readState();
    state.errors[projectId] = error;
    await this.writeState(state);
  }

  private async writeState(state: AppState): Promise<void> {
    await fs.mkdir(path.dirname(this.paths.statePath), { recursive: true });
    await fs.writeFile(this.paths.statePath, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  }
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
