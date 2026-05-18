import { describe, expect, it } from "vitest";
import type { Project } from "@local-dev-cockpit/core";
import { formatPortUrl, projectMatchesQuery, recommendedProjectCommand, sortProjectsForDashboard } from "./project-view";

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
