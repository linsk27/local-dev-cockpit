import { describe, expect, it } from "vitest";
import type { Command } from "@local-dev-cockpit/core";
import { diagnoseCommandEnvironment, resolveSpawnInvocation, summarizeFailedRun, toNpmRunArgs } from "./process-manager.js";

describe("summarizeFailedRun", () => {
  it("turns Python missing dependency tracebacks into install guidance", () => {
    const summary = summarizeFailedRun(
      [
        "Traceback (most recent call last):\n",
        '  File "D:\\Gavin\\xiaozhi-python\\xiaozhi-server\\core\\utils\\wakeup_word.py", line 7, in <module>\n',
        "    import portalocker\n",
        "ModuleNotFoundError: No module named 'portalocker'\n"
      ],
      1
    );

    expect(summary).toContain("缺少 Python 依赖：portalocker");
    expect(summary).toContain("python -m pip install portalocker");
    expect(summary).toContain("Python 环境不一致");
  });

  it("turns Node missing packages into package-manager install guidance", () => {
    const summary = summarizeFailedRun(
      [
        "Error [ERR_MODULE_NOT_FOUND]: Cannot find package 'vite' imported from D:\\projects\\web\\vite.config.ts\n",
        "    at packageResolve (node:internal/modules/esm/resolve:857:9)\n"
      ],
      1,
      command({ command: "pnpm", args: ["run", "dev"] })
    );

    expect(summary).toContain("缺少 Node 依赖：vite");
    expect(summary).toContain("pnpm install");
    expect(summary).toContain("pnpm add vite");
  });

  it("explains missing local Node script binaries as dependency install issues", () => {
    const summary = summarizeFailedRun(
      ["'vite' is not recognized as an internal or external command,\n", "operable program or batch file.\n"],
      1,
      command({ command: "npm", args: ["run", "dev"] })
    );

    expect(summary).toContain("脚本命令缺失：vite");
    expect(summary).toContain("npm install");
    expect(summary).toContain("devDependencies");
  });

  it("does not suggest package install for missing relative Node modules", () => {
    const summary = summarizeFailedRun(
      ["Error: Cannot find module './generated/client'\n", "Require stack:\n", "- D:\\projects\\api\\src\\index.js\n"],
      1,
      command({ command: "node", args: ["src/index.js"] })
    );

    expect(summary).toContain("Node 无法找到本地文件或模块：./generated/client");
    expect(summary).toContain("请检查源码路径");
    expect(summary).not.toContain("npm install ./generated/client");
  });

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
  it("uses a project-local Python virtual environment before PATH python", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["-m", "uvicorn", "app.main:app"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        fileExists: async (filePath) => filePath === "D:\\projects\\api\\.venv\\Scripts\\python.exe",
        commandExists: async () => true
      })
    ).resolves.toEqual({
      command: "D:\\projects\\api\\.venv\\Scripts\\python.exe",
      args: ["-m", "uvicorn", "app.main:app"],
      note: "已使用项目 Python 环境：.venv\\Scripts\\python.exe。"
    });
  });

  it("uses a parent workspace Python virtual environment for split frontend/backend repos", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\workspace\\backend" }), {
        platform: "win32",
        fileExists: async (filePath) => filePath === "D:\\projects\\workspace\\.venv\\Scripts\\python.exe",
        commandExists: async () => true
      })
    ).resolves.toMatchObject({
      command: "D:\\projects\\workspace\\.venv\\Scripts\\python.exe",
      args: ["app.py"]
    });
  });

  it("runs Python commands through a declared Conda environment when no local env exists", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["run.py"], cwd: "D:\\projects\\conda-api" }), {
        platform: "win32",
        fileExists: async (filePath) => filePath === "D:\\projects\\conda-api\\environment.yml",
        readFile: async () => "name: api-env\ndependencies:\n  - python=3.11\n",
        commandExists: async (name) => name === "conda.bat"
      })
    ).resolves.toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "conda", "run", "-n", "api-env", "python", "run.py"],
      note: "已通过 Conda 环境 api-env 运行；来源：D:\\projects\\conda-api\\environment.yml。"
    });
  });

  it("returns an actionable Python error when no interpreter is available", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        fileExists: async () => false,
        commandExists: async () => false
      })
    ).rejects.toThrow("未找到可用的 Python");
  });

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

  it("reports missing verified runtimes before spawning", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "dotnet", args: ["run"] }), {
        platform: "win32",
        commandExists: async () => false
      })
    ).rejects.toThrow("dotnet 未安装或不在 PATH 中");
  });
});

describe("diagnoseCommandEnvironment", () => {
  it("warns before running Node scripts when dependencies are not installed", async () => {
    await expect(
      diagnoseCommandEnvironment(command({ command: "pnpm", args: ["run", "dev"], cwd: "D:\\projects\\web" }), {
        platform: "win32",
        commandExists: async (name) => name === "pnpm.cmd",
        fileExists: async (filePath) => filePath === "D:\\projects\\web\\package.json",
        readFile: async () => JSON.stringify({ dependencies: { vue: "^3.5.0" }, devDependencies: { vite: "^5.0.0" } })
      })
    ).resolves.toMatchObject({
      status: "warn",
      summary: "项目依赖可能尚未安装。",
      detail: expect.stringContaining("pnpm install")
    });
  });

  it("returns ready diagnostics with the resolved project Python environment", async () => {
    await expect(
      diagnoseCommandEnvironment(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        fileExists: async (filePath) => filePath === "D:\\projects\\api\\venv\\Scripts\\python.exe",
        commandExists: async () => false
      })
    ).resolves.toMatchObject({
      commandId: "script-dev",
      status: "ready",
      summary: "已使用项目 Python 环境：venv\\Scripts\\python.exe。",
      resolvedCommand: "D:\\projects\\api\\venv\\Scripts\\python.exe app.py"
    });
  });

  it("warns when Python dependency manifests exist without a project environment", async () => {
    await expect(
      diagnoseCommandEnvironment(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        fileExists: async (filePath) => filePath === "D:\\projects\\api\\requirements.txt",
        commandExists: async (name) => name === "python.cmd" || name === "python"
      })
    ).resolves.toMatchObject({
      status: "warn",
      summary: "Python 项目依赖环境未固定。",
      detail: expect.stringContaining("系统 Python")
    });
  });

  it("returns missing diagnostics for unavailable runtimes", async () => {
    await expect(
      diagnoseCommandEnvironment(command({ command: "mvn", args: ["spring-boot:run"] }), {
        platform: "win32",
        commandExists: async () => false
      })
    ).resolves.toMatchObject({
      status: "missing",
      detail: expect.stringContaining("mvn 未安装或不在 PATH 中")
    });
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
