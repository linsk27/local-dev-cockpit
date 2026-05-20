import { describe, expect, it } from "vitest";
import type { Project } from "@local-dev-cockpit/core";
import { formatScanProject } from "./scan-output.js";

describe("scan output", () => {
  it("shows command previews for runnable projects", () => {
    const lines = formatScanProject(
      project({
        commands: [
          { id: "dev", label: "dev", command: "pnpm", args: ["run", "dev"], cwd: "D:\\app", source: "package-script", kind: "dev" },
          { id: "build", label: "build", command: "pnpm", args: ["run", "build"], cwd: "D:\\app", source: "package-script", kind: "build" }
        ]
      })
    );

    expect(lines).toContain("  commands: dev, build");
  });

  it("shows actionable guidance for projects without commands", () => {
    const lines = formatScanProject(project({ kind: "python", commands: [], markers: ["requirements.txt"] }));

    expect(lines.join("\n")).toContain("hint:");
    expect(lines.join("\n")).toContain("app.py");
  });
});

function project(overrides: Partial<Project> = {}): Project {
  return {
    id: overrides.id ?? "project",
    name: overrides.name ?? "project",
    path: overrides.path ?? "D:\\app",
    kind: overrides.kind ?? "node",
    packageManager: overrides.packageManager,
    git: overrides.git ?? { branch: "main", dirtyCount: 0 },
    commands: overrides.commands ?? [],
    ports: overrides.ports ?? [],
    markers: overrides.markers ?? ["package.json"],
    lastRun: overrides.lastRun,
    lastError: overrides.lastError
  };
}
