import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProcessRun } from "@local-dev-cockpit/core";
import {
  JsonStore,
  projectEnvironmentForPath,
  rootId,
  sanitizeCommandInput,
  sanitizeEnvironmentInput,
  sanitizePathInput,
  toPublicAiSettings
} from "./store.js";

describe("JsonStore roots", () => {
  it("starts without implicit roots so first-run onboarding can choose the workspace", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-store-"));
    const store = new JsonStore(
      {
        dataDir: tmp,
        configPath: path.join(tmp, "config.json"),
        statePath: path.join(tmp, "state.json"),
        logsDir: path.join(tmp, "logs")
      },
      "D:\\unexpected\\cwd"
    );

    const config = await store.readConfig();

    expect(config.roots).toEqual([]);
  });

  it("removes roots by stable URL-safe id", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-store-"));
    const paths = {
      dataDir: tmp,
      configPath: path.join(tmp, "config.json"),
      statePath: path.join(tmp, "state.json"),
      logsDir: path.join(tmp, "logs")
    };
    const store = new JsonStore(paths, tmp);
    const root = path.join(tmp, "root one");

    await store.addRoot(root);
    const afterRemove = await store.removeRoot(rootId(path.resolve(root)));

    expect(afterRemove.roots).not.toContain(path.resolve(root));
  });

  it("serializes concurrent root updates", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-store-"));
    const store = new JsonStore(
      {
        dataDir: tmp,
        configPath: path.join(tmp, "config.json"),
        statePath: path.join(tmp, "state.json"),
        logsDir: path.join(tmp, "logs")
      },
      tmp
    );
    const roots = ["app", "api", "worker", "docs"].map((name) => path.join(tmp, name));

    await Promise.all(roots.map((root) => store.addRoot(root)));

    const config = await store.readConfig();
    expect([...config.roots].sort()).toEqual(roots.map((root) => path.resolve(root)).sort());
  });

  it("keeps pasted Windows drive paths absolute after hidden bidi characters", async () => {
    expect(sanitizePathInput("\u202AC:\\Users\\EDY\\Desktop")).toBe("C:\\Users\\EDY\\Desktop");
    expect(sanitizePathInput("?C:\\Users\\EDY\\Desktop")).toBe("C:\\Users\\EDY\\Desktop");
  });

  it("strips wrapping quotes from copied paths", async () => {
    expect(sanitizePathInput('"C:\\Users\\EDY\\Desktop"')).toBe("C:\\Users\\EDY\\Desktop");
  });

  it("sanitizes copied editor commands", () => {
    expect(sanitizeCommandInput("\u202Acode --reuse-window")).toBe("code --reuse-window");
  });

  it("sanitizes copied environment bindings", () => {
    expect(sanitizeEnvironmentInput('"\u202Aconda:api-env"')).toBe("conda:api-env");
  });

  it("updates the configured editor command", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-store-"));
    const store = new JsonStore(
      {
        dataDir: tmp,
        configPath: path.join(tmp, "config.json"),
        statePath: path.join(tmp, "state.json"),
        logsDir: path.join(tmp, "logs")
      },
      tmp
    );

    const config = await store.updateEditorCommand("cursor");

    expect(config.editorCommand).toBe("cursor");
    await expect(store.updateEditorCommand("   ")).rejects.toThrow("Editor command is empty");
  });

  it("falls back to defaults when config or state JSON is damaged", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-store-"));
    const paths = {
      dataDir: tmp,
      configPath: path.join(tmp, "config.json"),
      statePath: path.join(tmp, "state.json"),
      logsDir: path.join(tmp, "logs")
    };
    const store = new JsonStore(paths, tmp);
    await store.ensure();
    await fs.writeFile(paths.configPath, "{not-json", "utf8");
    await fs.writeFile(paths.statePath, "{not-json", "utf8");

    await expect(store.readConfig()).resolves.toMatchObject({ roots: [], editorCommand: "code" });
    await expect(store.readState()).resolves.toEqual({ runs: {}, errors: {} });
  });

  it("stores and clears project environment bindings by resolved project path", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-store-"));
    const store = new JsonStore(
      {
        dataDir: tmp,
        configPath: path.join(tmp, "config.json"),
        statePath: path.join(tmp, "state.json"),
        logsDir: path.join(tmp, "logs")
      },
      tmp
    );
    const projectPath = path.join(tmp, "api");

    let config = await store.updateProjectEnvironment(projectPath, "conda:api-env");
    expect(projectEnvironmentForPath(config, projectPath)).toEqual({ python: "conda:api-env" });

    config = await store.updateProjectEnvironment(projectPath, "   ");
    expect(projectEnvironmentForPath(config, projectPath)).toBeUndefined();
  });

  it("stores AI settings separately and never exposes the raw API key in public settings", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-store-"));
    const store = new JsonStore(
      {
        dataDir: tmp,
        configPath: path.join(tmp, "config.json"),
        statePath: path.join(tmp, "state.json"),
        logsDir: path.join(tmp, "logs")
      },
      tmp
    );

    const settings = await store.updateAiSettings({
      providerId: "rayinai",
      baseUrl: "https://api.example.test/v1/",
      model: "resource-parser",
      outputLocale: "en-US",
      apiKey: "secret-key"
    });

    expect(settings).toMatchObject({
      providerId: "rayinai",
      baseUrl: "https://api.example.test/v1",
      model: "resource-parser",
      outputLocale: "en-US",
      apiKey: "secret-key"
    });
    expect(toPublicAiSettings(settings)).toEqual({
      provider: "openai-compatible",
      providerId: "rayinai",
      baseUrl: "https://api.example.test/v1",
      model: "resource-parser",
      outputLocale: "en-US",
      hasApiKey: true,
      source: "local"
    });

    const cleared = await store.updateAiSettings({ clearApiKey: true });
    expect(cleared.apiKey).toBe("");
  });

  it("can clear a stale running state without a live process", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-store-"));
    const store = new JsonStore(
      {
        dataDir: tmp,
        configPath: path.join(tmp, "config.json"),
        statePath: path.join(tmp, "state.json"),
        logsDir: path.join(tmp, "logs")
      },
      tmp
    );
    const run: ProcessRun = {
      id: "run-1",
      projectId: "project-1",
      commandId: "script-dev",
      status: "running",
      startedAt: new Date().toISOString(),
      logPath: path.join(tmp, "run-1.log")
    };

    await store.recordRun(run);
    const stopped = await store.markRunStopped(run.projectId, run.id);
    const state = await store.readState();

    expect(stopped?.status).toBe("stopped");
    expect(state.runs[run.projectId]?.status).toBe("stopped");
  });

  it("serializes concurrent run state updates", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-store-"));
    const store = new JsonStore(
      {
        dataDir: tmp,
        configPath: path.join(tmp, "config.json"),
        statePath: path.join(tmp, "state.json"),
        logsDir: path.join(tmp, "logs")
      },
      tmp
    );
    const runs: ProcessRun[] = ["project-a", "project-b", "project-c"].map((projectId) => ({
      id: `run-${projectId}`,
      projectId,
      commandId: "script-dev",
      status: "running",
      startedAt: new Date().toISOString(),
      logPath: path.join(tmp, `${projectId}.log`)
    }));

    await Promise.all(runs.map((run) => store.recordRun(run)));

    const state = await store.readState();
    expect(Object.keys(state.runs).sort()).toEqual(["project-a", "project-b", "project-c"]);
  });
});
