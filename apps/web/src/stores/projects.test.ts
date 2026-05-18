import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Project } from "@local-dev-cockpit/core";
import { getLogs, getProject, startCommand } from "../api";
import { useProjectsStore } from "./projects";

vi.mock("../api", () => ({
  getContext: vi.fn(),
  getLogs: vi.fn(async () => ""),
  getProject: vi.fn(),
  getProjects: vi.fn(),
  startCommand: vi.fn(),
  stopPort: vi.fn(),
  stopProcess: vi.fn()
}));

describe("projects store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("starts the explicitly requested project, not the globally selected one", async () => {
    const alpha = project("alpha");
    const beta = project("beta");
    const store = useProjectsStore();
    store.projects = [alpha, beta];
    store.selectedId = beta.id;

    vi.mocked(startCommand).mockResolvedValue({
      run: {
        id: "alpha-run",
        projectId: alpha.id,
        commandId: "script-dev",
        status: "running",
        startedAt: "2026-05-18T00:00:00.000Z",
        logPath: "alpha-run.log"
      }
    });
    vi.mocked(getProject).mockResolvedValue(alpha);

    await store.runCommand("script-dev", alpha.id);

    expect(startCommand).toHaveBeenCalledWith(alpha.id, "script-dev");
    expect(getLogs).toHaveBeenCalledWith(alpha.id, "alpha-run");
    expect(store.projects.find((item) => item.id === alpha.id)?.lastRun?.id).toBe("alpha-run");
    expect(store.selectedId).toBe(beta.id);
  });
});

function project(id: string): Project {
  return {
    id,
    name: id,
    path: `D:\\projects\\${id}`,
    kind: "node",
    git: { branch: "main", dirtyCount: 0 },
    commands: [
      {
        id: "script-dev",
        label: "dev",
        command: "npm",
        args: ["run", "dev"],
        cwd: `D:\\projects\\${id}`,
        source: "package-script",
        kind: "dev"
      }
    ],
    ports: [],
    markers: ["package.json"]
  };
}
