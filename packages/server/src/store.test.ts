import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { ProcessRun } from "@local-dev-cockpit/core";
import { JsonStore, rootId, sanitizeCommandInput, sanitizePathInput } from "./store.js";

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
});
