import { describe, expect, it } from "vitest";
import type { Command } from "@local-dev-cockpit/core";
import { resolveSpawnInvocation, summarizeFailedRun, toNpmRunArgs } from "./process-manager.js";

describe("summarizeFailedRun", () => {
  it("prefers actionable Next.js duplicate server messages", () => {
    const summary = summarizeFailedRun(
      [
        "Next.js 16.2.0\n",
        "Port 3000 is in use by process 5796, using available port 3001 instead.\n",
        "Local:         http://localhost:3001\n",
        "Another next dev server is already running.\n",
        "PID:          5796\n",
        "Run taskkill /PID 5796 /F to stop it.\n",
        "Command failed with exit code 1.\n"
      ],
      1
    );

    expect(summary).toContain("Another next dev server is already running.");
    expect(summary).toContain("Run taskkill /PID 5796 /F to stop it.");
    expect(summary).toContain("exit code 1");
  });
});

describe("resolveSpawnInvocation", () => {
  it("falls back from missing yarn to npm when package-lock.json is present", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "yarn", args: ["run", "dev", "--host", "127.0.0.1"] }), {
        platform: "win32",
        commandExists: async (name) => name === "npm.cmd",
        fileExists: async (filePath) => filePath.endsWith("package-lock.json")
      })
    ).resolves.toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "npm.cmd", "run", "dev", "--", "--host", "127.0.0.1"],
      note: "yarn 未安装，且项目存在 package-lock.json，已改用 npm 运行该脚本。"
    });
  });

  it("uses corepack for missing pnpm or yarn before falling back to npm", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "pnpm", args: ["run", "dev"] }), {
        platform: "win32",
        commandExists: async (name) => name === "corepack.cmd",
        fileExists: async () => false
      })
    ).resolves.toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "corepack.cmd", "pnpm", "run", "dev"],
      note: "pnpm 未安装，已通过 corepack 尝试运行。"
    });
  });

  it("returns an actionable error when no package manager fallback is available", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "yarn", args: ["run", "dev"] }), {
        platform: "win32",
        commandExists: async () => false,
        fileExists: async () => false
      })
    ).rejects.toThrow("yarn 未安装或不在 PATH 中");
  });
});

describe("toNpmRunArgs", () => {
  it("inserts npm's -- separator before forwarded script arguments", () => {
    expect(toNpmRunArgs(["run", "dev", "--host", "127.0.0.1"])).toEqual(["run", "dev", "--", "--host", "127.0.0.1"]);
    expect(toNpmRunArgs(["run", "dev", "--", "--host", "127.0.0.1"])).toEqual(["run", "dev", "--", "--host", "127.0.0.1"]);
  });
});

function command(overrides: Partial<Command> = {}): Command {
  return {
    id: "script-dev",
    label: "dev",
    command: overrides.command ?? "npm",
    args: overrides.args ?? ["run", "dev"],
    cwd: overrides.cwd ?? "D:\\projects\\demo",
    source: "package-script",
    kind: "dev"
  };
}
