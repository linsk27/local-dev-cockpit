import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import type { Project } from "@local-dev-cockpit/core";
import { getContext, getLogs, getProject, getProjects, openProjectEditor, openProjectFolder, startCommand, writeContext } from "../api";
import { useProjectsStore } from "./projects";

vi.mock("../api", () => ({
  getContext: vi.fn(),
  getLogs: vi.fn(async () => ""),
  getProject: vi.fn(),
  getProjects: vi.fn(),
  openProjectEditor: vi.fn(),
  openProjectFolder: vi.fn(),
  startCommand: vi.fn(),
  stopPort: vi.fn(),
  stopProcess: vi.fn(),
  writeContext: vi.fn()
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

  it("writes AI context files for the selected project only after an explicit action", async () => {
    const alpha = project("alpha");
    const store = useProjectsStore();
    store.projects = [alpha];
    store.selectedId = alpha.id;
    vi.mocked(writeContext).mockResolvedValue({
      files: [`${alpha.path}\\PROJECT_CONTEXT.md`, `${alpha.path}\\AGENTS.md`]
    });

    const result = await store.writeContextFiles();

    expect(writeContext).toHaveBeenCalledWith(alpha.id);
    expect(result?.files).toHaveLength(2);
    expect(store.error).toBe("");
  });

  it("opens a project folder by project id without changing selection", async () => {
    const alpha = project("alpha");
    const beta = project("beta");
    const store = useProjectsStore();
    store.projects = [alpha, beta];
    store.selectedId = beta.id;
    vi.mocked(openProjectFolder).mockResolvedValue({ opened: true, path: alpha.path });

    await expect(store.openProjectFolder(alpha.id)).resolves.toBe(true);

    expect(openProjectFolder).toHaveBeenCalledWith(alpha.id);
    expect(store.selectedId).toBe(beta.id);
  });

  it("opens a project in the configured editor by project id", async () => {
    const alpha = project("alpha");
    const store = useProjectsStore();
    store.projects = [alpha];
    vi.mocked(openProjectEditor).mockResolvedValue({ opened: true, path: alpha.path, command: "code" });

    await expect(store.openProjectEditor(alpha.id)).resolves.toBe(true);

    expect(openProjectEditor).toHaveBeenCalledWith(alpha.id);
  });

  it("can load context for a non-selected project without replacing the selected context", async () => {
    const alpha = project("alpha");
    const beta = project("beta");
    const store = useProjectsStore();
    store.projects = [alpha, beta];
    store.selectedId = beta.id;
    store.context = { context: "beta-context", agents: "", recovery: { title: "beta", summary: "beta", nextStep: "", facts: [] } };
    vi.mocked(getContext).mockResolvedValue({
      context: "alpha-context",
      agents: "",
      recovery: { title: "alpha", summary: "alpha", nextStep: "", facts: [] }
    });

    const context = await store.loadContext(alpha.id);

    expect(context?.context).toBe("alpha-context");
    expect(store.context?.context).toBe("beta-context");
  });

  it("keeps a watched running command when a stale full scan arrives", async () => {
    const alpha = project("alpha");
    const runningAlpha: Project = {
      ...alpha,
      lastRun: {
        id: "alpha-run",
        projectId: alpha.id,
        commandId: "script-dev",
        status: "running",
        startedAt: "2026-05-19T00:00:00.000Z",
        logPath: "alpha-run.log"
      },
      ports: [{ port: 3001, host: "localhost", status: "open", source: "process" }]
    };
    const staleAlpha = project("alpha");
    const store = useProjectsStore();
    store.projects = [runningAlpha];
    store.runtimeWatches = { [alpha.id]: "alpha-run" };
    vi.mocked(getProjects).mockResolvedValue([staleAlpha]);

    await store.refresh({ silent: true });

    const refreshed = store.projects[0];
    expect(refreshed?.lastRun?.status).toBe("running");
    expect(refreshed?.lastRun?.id).toBe("alpha-run");
    expect(refreshed?.ports).toContainEqual({ port: 3001, host: "localhost", status: "open", source: "process" });
  });

  it("allows full scans to replace projects that are not being watched", async () => {
    const alpha = project("alpha");
    const runningAlpha: Project = {
      ...alpha,
      lastRun: {
        id: "alpha-run",
        projectId: alpha.id,
        commandId: "script-dev",
        status: "running",
        startedAt: "2026-05-19T00:00:00.000Z",
        logPath: "alpha-run.log"
      }
    };
    const idleAlpha = project("alpha");
    const store = useProjectsStore();
    store.projects = [runningAlpha];
    vi.mocked(getProjects).mockResolvedValue([idleAlpha]);

    await store.refresh({ silent: true });

    expect(store.projects[0]?.lastRun).toBeUndefined();
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
