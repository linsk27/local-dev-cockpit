import { describe, expect, it } from "vitest";
import { noCommandGuidance, shouldInspectPythonEnvironment } from "./doctor-guidance.js";

describe("doctor guidance", () => {
  it("explains no-command projects by likely stack", () => {
    expect(noCommandGuidance({ kind: "node", markers: ["package.json"] })).toContain("dev/start");
    expect(noCommandGuidance({ kind: "python", markers: ["requirements.txt"] })).toContain("app.py");
    expect(noCommandGuidance({ kind: "docker", markers: ["Dockerfile"] })).toContain("compose");
    expect(noCommandGuidance({ kind: "unknown", markers: [] })).toContain("child app folder");
  });

  it("detects when doctor should inspect Python environments", () => {
    expect(shouldInspectPythonEnvironment({ kind: "python", markers: [], commands: [] })).toBe(true);
    expect(shouldInspectPythonEnvironment({ kind: "node", markers: ["pyproject.toml"], commands: [] })).toBe(true);
    expect(shouldInspectPythonEnvironment({ kind: "node", markers: [], commands: [{ command: "C:\\envs\\api\\python.exe" }] })).toBe(true);
    expect(shouldInspectPythonEnvironment({ kind: "node", markers: ["package.json"], commands: [{ command: "pnpm" }] })).toBe(false);
  });
});
