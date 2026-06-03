import { describe, expect, it } from "vitest";
import type { Project } from "@local-dev-cockpit/core";
import {
  buildProjectListFilters,
  classifyProjectForList,
  commandBlockedByStalePort,
  commandDeclaredPorts,
  commandWouldReuseOpenPort,
  formatDisplayPath,
  formatPortUrl,
  noCommandGuidance,
  projectBelongsToRoot,
  projectDiagnostics,
  projectFailureActionHint,
  projectFailureHeadline,
  projectHasAlreadyRunningConflict,
  projectHasFailed,
  projectHasStalePorts,
  projectMatchesQuery,
  projectRuntimeMode,
  projectStatusReason,
  recommendedProjectCommand,
  runtimeSourceLabel,
  sortProjectsForDashboard,
  stoppableProjectPorts,
  visibleProjectPorts
} from "./project-view";

describe("project dashboard view helpers", () => {
  it("sorts online projects before idle projects", () => {
    const idle = project({ name: "idle-api" });
    const online = project({
      name: "web-app",
      ports: [{ port: 5173, host: "localhost", status: "open", source: "process" }]
    });

    expect(sortProjectsForDashboard([idle, online]).map((item) => item.name)).toEqual(["web-app", "idle-api"]);
  });

  it("matches projects by path, branch, command, and port", () => {
    const target = project({
      name: "blog-admin",
      path: "D:\\personal\\blog-admin",
      branch: "feat/search",
      ports: [{ port: 3000, host: "127.0.0.1", status: "open", source: "process" }]
    });

    expect(projectMatchesQuery(target, "blog")).toBe(true);
    expect(projectMatchesQuery(target, "feat/search")).toBe(true);
    expect(projectMatchesQuery(target, "127.0.0.1:3000")).toBe(true);
    expect(projectMatchesQuery(target, "missing")).toBe(false);
  });

  it("deduplicates visible and stoppable ports by port number", () => {
    const target = project({
      ports: [
        { port: 3000, host: "localhost", url: "http://localhost:3000", status: "open", source: "detected" },
        { port: 3000, host: "127.0.0.1", url: "http://127.0.0.1:3000", status: "open", source: "detected" },
        { port: 3001, host: "localhost", status: "open", source: "process" },
        { port: 3001, host: "127.0.0.1", status: "open", source: "process" },
        { port: 8000, host: "127.0.0.1", status: "unknown", source: "detected" }
      ]
    });

    expect(visibleProjectPorts(target).map((port) => port.port)).toEqual([3000, 3001]);
    expect(stoppableProjectPorts(target).map((port) => port.port)).toEqual([3000, 3001, 8000]);
  });

  it("extracts declared command ports from args and metadata", () => {
    expect(
      commandDeclaredPorts({
        id: "dev",
        label: "dev",
        command: "pnpm",
        args: ["run", "dev", "--", "--host", "127.0.0.1", "--port", "5173"],
        ports: [3000],
        cwd: "D:\\personal\\project",
        source: "package-script",
        kind: "dev"
      })
    ).toEqual([3000, 5173]);
  });

  it("classifies projects for list filters by runtime confidence", () => {
    expect(
      classifyProjectForList(
        project({
          ports: [{ port: 5173, host: "localhost", status: "open", source: "detected" }]
        })
      )
    ).toBe("online");
    expect(classifyProjectForList(project())).toBe("standard-runnable");
    expect(
      classifyProjectForList(
        project({
          kind: "unknown",
          commands: [
            {
              id: "custom",
              label: "custom",
              command: "run-local",
              args: [],
              cwd: "D:\\personal\\project",
              source: "user",
              kind: "custom"
            }
          ],
          markers: []
        })
      )
    ).toBe("try-runnable");
    expect(classifyProjectForList(project({ commands: [], markers: [] }))).toBe("unidentified");
    expect(
      classifyProjectForList(
        project({
          lastRun: {
            id: "run-1",
            projectId: "project",
            commandId: "script-dev",
            status: "failed",
            startedAt: new Date().toISOString(),
            logPath: "run.log"
          }
        })
      )
    ).toBe("needs-attention");
  });

  it("builds project list filter counts", () => {
    const summaries = buildProjectListFilters([
      project({ name: "standard" }),
      project({ name: "online", ports: [{ port: 3000, status: "open", source: "detected" }] }),
      project({ name: "unknown", kind: "unknown", commands: [], markers: [] })
    ]);

    expect(Object.fromEntries(summaries.map((item) => [item.id, item.count]))).toMatchObject({
      all: 3,
      online: 1,
      "standard-runnable": 1,
      unidentified: 1
    });
  });

  it("filters projects by root path boundary and formats paths", () => {
    const target = project({ path: "D:\\personal\\blog-admin" });

    expect(projectBelongsToRoot(target, "D:\\personal")).toBe(true);
    expect(projectBelongsToRoot(target, "D:\\personal-other")).toBe(false);
    expect(formatDisplayPath("D:\\\\personal")).toBe("D:\\personal");
    expect(formatDisplayPath("\\\\server\\\\share")).toBe("\\\\server\\share");
  });

  it("lets current online ports override stale failure display", () => {
    expect(
      projectHasFailed(
        project({
          lastRun: {
            id: "run-1",
            projectId: "project",
            commandId: "script-dev",
            status: "failed",
            startedAt: new Date().toISOString(),
            logPath: "run.log"
          },
          lastError: {
            commandId: "script-dev",
            message: "previous command exited with code 1",
            occurredAt: new Date().toISOString()
          },
          ports: [{ port: 3000, host: "localhost", status: "open", source: "detected" }]
        })
      )
    ).toBe(false);
  });

  it("does not let an auxiliary unknown port override a reachable endpoint", () => {
    const target = project({
      ports: [
        { port: 3000, host: "127.0.0.1", status: "open", source: "detected" },
        { port: 56290, host: "127.0.0.1", status: "unknown", source: "detected" }
      ]
    });

    expect(projectHasStalePorts(target)).toBe(false);
  });

  it("treats already-running port conflicts as online instead of failed", () => {
    const alreadyRunning = project({
      lastRun: {
        id: "run-1",
        projectId: "project",
        commandId: "script-dev",
        status: "failed",
        startedAt: new Date().toISOString(),
        logPath: "run.log"
      },
      lastError: {
        commandId: "script-dev",
        message: "Another next dev server is already running. - Local: http://localhost:3000 - PID: 5796",
        occurredAt: new Date().toISOString()
      },
      ports: [{ port: 3000, host: "127.0.0.1", status: "open", source: "detected" }]
    });

    expect(projectHasAlreadyRunningConflict(alreadyRunning)).toBe(true);
    expect(projectHasFailed(alreadyRunning)).toBe(false);
  });

  it("returns concise action hints for common failures", () => {
    const pythonMissingProject = project({
      lastError: {
        commandId: "script-dev",
        message: "缺少 Python 依赖：portalocker。请在该项目当前 Python 环境中安装：conda run -n api-env python -m pip install portalocker。",
        occurredAt: new Date().toISOString()
      }
    });

    expect(projectFailureHeadline(pythonMissingProject)).toBe("缺少 Python 依赖：portalocker");
    expect(projectFailureActionHint(pythonMissingProject)).toContain("Python 环境");
    expect(
      projectFailureActionHint(
        project({
          lastError: {
            commandId: "script-dev",
            message: "端口已被占用：127.0.0.1:8000。",
            occurredAt: new Date().toISOString()
          }
        })
      )
    ).toContain("停止或清理占用端口");
  });

  it("blocks commands that would reuse open or stale ports", () => {
    expect(
      commandWouldReuseOpenPort(
        project({ ports: [{ port: 8000, status: "open", source: "detected" }] }),
        {
          id: "python-fastapi-app-main",
          label: "Uvicorn app.main",
          command: "python",
          args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
          cwd: "backend",
          source: "detected",
          kind: "dev"
        }
      )
    ).toBe(true);

    expect(
      commandBlockedByStalePort(
        project({
          ports: [{ port: 3000, host: "localhost", status: "unknown", source: "detected" }]
        }),
        {
          id: "script-dev",
          label: "dev",
          command: "npm",
          args: ["run", "dev"],
          cwd: "D:\\personal\\project",
          source: "package-script",
          kind: "dev"
        }
      )
    ).toBe(true);
  });

  it("keeps commands runnable while the project has a managed running process", () => {
    const runningProject = project({
      lastRun: {
        id: "run-1",
        projectId: "project",
        commandId: "script-dev",
        status: "running",
        startedAt: new Date().toISOString(),
        logPath: "run.log"
      },
      ports: [
        { port: 3000, host: "localhost", status: "open", source: "detected" },
        { port: 3001, host: "localhost", status: "unknown", source: "detected" }
      ]
    });
    const devCommand = runningProject.commands[0]!;

    expect(commandWouldReuseOpenPort(runningProject, devCommand)).toBe(false);
    expect(commandBlockedByStalePort(runningProject, devCommand)).toBe(false);
  });

  it("explains project status source in user-facing language", () => {
    expect(
      projectStatusReason(
        project({
          ports: [{ port: 3000, host: "127.0.0.1", status: "open", source: "detected" }]
        })
      )
    ).toContain("系统检测到");

    expect(
      projectStatusReason(
        project({
          lastError: {
            commandId: "script-dev",
            message: "yarn 未安装",
            occurredAt: new Date().toISOString()
          }
        })
      )
    ).toContain("上次命令失败");

    expect(projectStatusReason(project({ ports: [{ port: 5173, host: "localhost", status: "open", source: "detected" }] }), "en-US")).toContain(
      "Detected"
    );
  });

  it("separates managed running services from externally detected services", () => {
    const managed = project({
      lastRun: {
        id: "run-1",
        projectId: "project",
        commandId: "script-dev",
        status: "running",
        startedAt: new Date().toISOString(),
        logPath: "run.log"
      },
      ports: [{ port: 3001, host: "localhost", status: "open", source: "process" }]
    });
    const external = project({
      ports: [{ port: 3001, host: "127.0.0.1", status: "open", source: "detected" }]
    });

    expect(projectRuntimeMode(managed)).toBe("managed-running");
    expect(projectRuntimeMode(external)).toBe("detected-online");
    expect(runtimeSourceLabel(managed)).toBe("Dev Cockpit 托管");
    expect(runtimeSourceLabel(external)).toBe("系统外部检测");
  });

  it("builds compact diagnostics for commands, ports, failures, and next action", () => {
    const target = project({
      packageManager: "npm",
      ports: [{ port: 8000, host: "127.0.0.1", status: "open", source: "detected" }]
    });
    target.commands = [
      {
        id: "python-fastapi-app-main",
        label: "Uvicorn app.main",
        command: "python",
        args: ["-m", "uvicorn", "app.main:app", "--host", "127.0.0.1", "--port", "8000"],
        cwd: target.path,
        source: "detected",
        kind: "dev"
      }
    ];

    const diagnostics = projectDiagnostics(target);

    expect(diagnostics.map((item) => item.id)).toEqual(["environment", "ports", "failure", "next"]);
    expect(diagnostics.find((item) => item.id === "environment")?.detail).toContain("python -m uvicorn");
    expect(diagnostics.find((item) => item.id === "ports")?.value).toBe("系统检测");
    expect(diagnostics.find((item) => item.id === "next")?.detail).toContain("127.0.0.1:8000");
  });

  it("shows actionable guidance when no commands are detected", () => {
    const pythonApi = project({
      kind: "python",
      commands: [],
      markers: ["requirements.txt", "pyproject.toml"]
    });
    const nodeApp = project({
      kind: "node",
      commands: [],
      markers: ["package.json"]
    });
    const shellRepo = project({
      kind: "unknown",
      commands: [],
      markers: []
    });

    expect(noCommandGuidance(pythonApi)).toContain("app.py");
    expect(projectDiagnostics(pythonApi).find((item) => item.id === "next")?.detail).toContain("后端目录");
    expect(noCommandGuidance(nodeApp)).toContain("dev/start");
    expect(noCommandGuidance(shellRepo, "en-US")).toContain("child app folder");
  });

  it("formats ipv6 hosts as browser-safe URLs", () => {
    expect(formatPortUrl({ port: 5173, host: "::1" })).toBe("http://[::1]:5173");
  });

  it("recommends the failed command before falling back to dev", () => {
    const target = project({
      commands: [
        {
          id: "script-dev",
          label: "dev",
          command: "pnpm",
          args: ["run", "dev"],
          cwd: "D:\\personal\\project",
          source: "package-script",
          kind: "dev"
        },
        {
          id: "script-start",
          label: "start",
          command: "pnpm",
          args: ["run", "start"],
          cwd: "D:\\personal\\project",
          source: "package-script",
          kind: "start"
        }
      ],
      lastError: {
        commandId: "script-start",
        message: "Port already in use",
        occurredAt: new Date().toISOString()
      }
    });

    expect(recommendedProjectCommand(target)?.id).toBe("script-start");
    expect(recommendedProjectCommand(project())?.id).toBe("script-dev");
  });
});

function project(overrides: Partial<Project> & { branch?: string } = {}): Project {
  return {
    id: overrides.id ?? overrides.name ?? "project",
    name: overrides.name ?? "project",
    path: overrides.path ?? "D:\\personal\\project",
    kind: overrides.kind ?? "node",
    packageManager: overrides.packageManager,
    git: {
      branch: overrides.branch ?? overrides.git?.branch ?? "main",
      dirtyCount: overrides.git?.dirtyCount ?? 0,
      lastCommit: overrides.git?.lastCommit
    },
    commands: overrides.commands ?? [
      {
        id: "script-dev",
        label: "dev",
        command: "pnpm",
        args: ["run", "dev"],
        cwd: overrides.path ?? "D:\\personal\\project",
        source: "package-script",
        kind: "dev"
      }
    ],
    ports: overrides.ports ?? [],
    lastRun: overrides.lastRun,
    lastError: overrides.lastError,
    markers: overrides.markers ?? ["package.json"]
  };
}
