import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { EventBus } from "../events.js";
import { ProcessManager } from "../process-manager.js";
import { JsonStore } from "../store.js";
import { loadProjects } from "./project-service.js";

describe("loadProjects", () => {
  it("deduplicates projects discovered through overlapping roots", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-project-service-"));
    const workspace = path.join(tmp, "workspace");
    const app = path.join(workspace, "app");
    const dataDir = path.join(tmp, "data");
    await fs.mkdir(app, { recursive: true });
    await fs.writeFile(path.join(app, "package.json"), JSON.stringify({ name: "app", scripts: { dev: "vite" } }), "utf8");

    const paths = {
      dataDir,
      configPath: path.join(dataDir, "config.json"),
      statePath: path.join(dataDir, "state.json"),
      logsDir: path.join(dataDir, "logs")
    };
    const store = new JsonStore(paths, tmp);
    await store.writeConfig({
      roots: [workspace, app],
      ignoreNames: [],
      editorCommand: "code",
      projectEnvironments: {}
    });
    const processManager = new ProcessManager(paths, store, new EventBus());

    const projects = await loadProjects(store, processManager);

    expect(projects.filter((project) => path.resolve(project.path) === path.resolve(app))).toHaveLength(1);
  });
});
