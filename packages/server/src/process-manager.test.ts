import { describe, expect, it } from "vitest";
import type { Command } from "@local-dev-cockpit/core";
import {
  diagnoseCommandEnvironment,
  discoverPythonEnvironmentCandidates,
  resolveSpawnInvocation,
  summarizeFailedRun,
  toNpmRunArgs,
  validatePythonEnvironmentBinding
} from "./process-manager.js";

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

  it("uses the Python interpreter configured by VS Code settings", async () => {
    const settingsPath = "D:\\projects\\api\\.vscode\\settings.json";
    const condaPython = "C:\\Users\\tester\\miniconda3\\envs\\api-env\\python.exe";
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        fileExists: async (filePath) => filePath === settingsPath || filePath === condaPython,
        readFile: async () => `{
          // Cursor and VS Code both store the selected interpreter here.
          "python.defaultInterpreterPath": "${condaPython.replace(/\\/g, "\\\\")}",
        }`,
        commandExists: async () => false
      })
    ).resolves.toMatchObject({
      command: condaPython,
      args: ["app.py"]
    });
  });

  it("uses a project-bound Python interpreter before editor settings and local envs", async () => {
    const boundPython = "C:\\Users\\tester\\miniconda3\\envs\\bound-api\\python.exe";
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        projectEnvironment: { python: boundPython },
        fileExists: async (filePath) => filePath === boundPython,
        commandExists: async () => false
      })
    ).resolves.toMatchObject({
      command: boundPython,
      args: ["app.py"]
    });
  });

  it("runs Python commands through a project-bound Conda environment", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        projectEnvironment: { python: "conda:api-env" },
        commandExists: async (name) => name === "conda"
      })
    ).resolves.toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "conda", "run", "-n", "api-env", "python", "app.py"],
      note: "已使用项目绑定的 Conda 环境：api-env。"
    });
  });

  it("resolves workspace-relative Python interpreter settings", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["server.py"], cwd: "D:\\projects\\workspace\\backend" }), {
        platform: "win32",
        fileExists: async (filePath) =>
          filePath === "D:\\projects\\workspace\\.vscode\\settings.json" ||
          filePath === "D:\\projects\\workspace\\.conda\\Scripts\\python.exe",
        readFile: async () => JSON.stringify({ "python.defaultInterpreterPath": "${workspaceFolder}\\.conda" }),
        commandExists: async () => false
      })
    ).resolves.toMatchObject({
      command: "D:\\projects\\workspace\\.conda\\Scripts\\python.exe",
      args: ["server.py"]
    });
  });

  it("uses an inherited Conda environment when Dev Cockpit is started from an activated terminal", async () => {
    const condaPrefix = "C:\\Users\\tester\\miniconda3\\envs\\terminal-api";
    const condaPython = `${condaPrefix}\\python.exe`;
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        env: { CONDA_PREFIX: condaPrefix, CONDA_DEFAULT_ENV: "terminal-api" },
        fileExists: async (filePath) => filePath === condaPython,
        commandExists: async () => false
      })
    ).resolves.toEqual({
      command: condaPython,
      args: ["app.py"],
      note: `已使用当前终端 Conda 环境：${condaPython}。`
    });
  });

  it("uses an inherited virtualenv when Dev Cockpit is started from an activated terminal", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        env: { VIRTUAL_ENV: "D:\\projects\\api\\.venv" },
        fileExists: async (filePath) => filePath === "D:\\projects\\api\\.venv\\Scripts\\python.exe",
        commandExists: async () => false
      })
    ).resolves.toMatchObject({
      command: "D:\\projects\\api\\.venv\\Scripts\\python.exe",
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

  it("runs Python commands through uv when uv.lock exists", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\uv-api" }), {
        platform: "win32",
        fileExists: async (filePath) => filePath === "D:\\projects\\uv-api\\uv.lock",
        commandExists: async (name) => name === "uv.cmd"
      })
    ).resolves.toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "uv", "run", "python", "app.py"],
      note: "已通过 uv 运行 Python 命令；来源：D:\\projects\\uv-api\\uv.lock。"
    });
  });

  it("runs Python commands through Poetry when pyproject declares tool.poetry", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["main.py"], cwd: "D:\\projects\\poetry-api" }), {
        platform: "win32",
        fileExists: async (filePath) => filePath === "D:\\projects\\poetry-api\\pyproject.toml",
        readFile: async () => "[tool.poetry]\nname = \"poetry-api\"\n",
        commandExists: async (name) => name === "poetry.cmd"
      })
    ).resolves.toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "poetry", "run", "python", "main.py"],
      note: "已通过 Poetry 运行 Python 命令；来源：D:\\projects\\poetry-api\\pyproject.toml。"
    });
  });

  it("runs Python commands through a parent Pipenv workspace", async () => {
    await expect(
      resolveSpawnInvocation(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\workspace\\backend" }), {
        platform: "win32",
        fileExists: async (filePath) => filePath === "D:\\projects\\workspace\\Pipfile",
        commandExists: async (name) => name === "pipenv.cmd"
      })
    ).resolves.toEqual({
      command: "cmd.exe",
      args: ["/d", "/s", "/c", "pipenv", "run", "python", "app.py"],
      note: "已通过 Pipenv 运行 Python 命令；来源：D:\\projects\\workspace\\Pipfile。"
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

  it("does not warn when the launching terminal has an active Conda environment", async () => {
    await expect(
      diagnoseCommandEnvironment(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        env: { CONDA_PREFIX: "C:\\Users\\tester\\miniconda3\\envs\\api-env" },
        fileExists: async (filePath) =>
          filePath === "D:\\projects\\api\\requirements.txt" ||
          filePath === "C:\\Users\\tester\\miniconda3\\envs\\api-env\\python.exe",
        commandExists: async () => false
      })
    ).resolves.toMatchObject({
      status: "ready",
      resolvedCommand: "C:\\Users\\tester\\miniconda3\\envs\\api-env\\python.exe app.py"
    });
  });

  it("does not warn when a project-bound Python environment is configured", async () => {
    await expect(
      diagnoseCommandEnvironment(command({ command: "python", args: ["app.py"], cwd: "D:\\projects\\api" }), {
        platform: "win32",
        projectEnvironment: { python: "D:\\envs\\api" },
        fileExists: async (filePath) =>
          filePath === "D:\\projects\\api\\requirements.txt" || filePath === "D:\\envs\\api\\Scripts\\python.exe",
        commandExists: async () => false
      })
    ).resolves.toMatchObject({
      status: "ready",
      resolvedCommand: "D:\\envs\\api\\Scripts\\python.exe app.py"
    });
  });

  it("warns when Maven projects rely on system Maven without a wrapper", async () => {
    await expect(
      diagnoseCommandEnvironment(command({ command: "mvn", args: ["spring-boot:run"], cwd: "D:\\projects\\java-api" }), {
        platform: "win32",
        commandExists: async (name) => name === "mvn.cmd",
        fileExists: async (filePath) => filePath === "D:\\projects\\java-api\\pom.xml"
      })
    ).resolves.toMatchObject({
      status: "warn",
      summary: "Java 项目未提交 Maven wrapper。",
      detail: expect.stringContaining("mvnw")
    });
  });

  it("warns when PHP Composer dependencies are not installed", async () => {
    await expect(
      diagnoseCommandEnvironment(command({ command: "php", args: ["artisan", "serve"], cwd: "D:\\projects\\laravel" }), {
        platform: "win32",
        commandExists: async (name) => name === "php.cmd",
        fileExists: async (filePath) => filePath === "D:\\projects\\laravel\\composer.json"
      })
    ).resolves.toMatchObject({
      status: "warn",
      summary: "PHP 依赖可能尚未安装。",
      detail: expect.stringContaining("composer install")
    });
  });

  it("warns when Ruby projects have a Gemfile without a lockfile", async () => {
    await expect(
      diagnoseCommandEnvironment(command({ command: "bundle", args: ["exec", "rails", "server"], cwd: "D:\\projects\\rails" }), {
        platform: "win32",
        commandExists: async (name) => name === "bundle.bat",
        fileExists: async (filePath) => filePath === "D:\\projects\\rails\\Gemfile"
      })
    ).resolves.toMatchObject({
      status: "warn",
      summary: "Ruby 依赖锁定文件缺失。",
      detail: expect.stringContaining("bundle install")
    });
  });

  it("warns when .NET restore assets are missing", async () => {
    await expect(
      diagnoseCommandEnvironment(command({ command: "dotnet", args: ["run"], cwd: "D:\\projects\\dotnet-api" }), {
        platform: "win32",
        commandExists: async (name) => name === "dotnet.cmd",
        fileExists: async (filePath) => filePath === "D:\\projects\\dotnet-api\\project.csproj"
      })
    ).resolves.toMatchObject({
      status: "warn",
      summary: ".NET restore 产物未发现。",
      detail: expect.stringContaining("dotnet restore")
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

describe("discoverPythonEnvironmentCandidates", () => {
  it("lists local, editor, conda-file, and inherited Python environment candidates", async () => {
    const projectPath = "D:\\projects\\workspace\\backend";
    const settingsPath = "D:\\projects\\workspace\\.vscode\\settings.json";
    const vscodePython = "D:\\tools\\python\\python.exe";
    const localPython = "D:\\projects\\workspace\\backend\\.venv\\Scripts\\python.exe";
    const parentPython = "D:\\projects\\workspace\\.venv\\Scripts\\python.exe";
    const terminalPython = "C:\\Users\\tester\\miniconda3\\envs\\terminal-api\\python.exe";

    const candidates = await discoverPythonEnvironmentCandidates(projectPath, {
      platform: "win32",
      env: { CONDA_PREFIX: "C:\\Users\\tester\\miniconda3\\envs\\terminal-api", CONDA_DEFAULT_ENV: "terminal-api" },
      fileExists: async (filePath) =>
        [settingsPath, vscodePython, localPython, parentPython, terminalPython, "D:\\projects\\workspace\\environment.yml"].includes(filePath),
      readFile: async (filePath) =>
        filePath === settingsPath ? JSON.stringify({ "python.defaultInterpreterPath": vscodePython }) : "name: workspace-api\n"
    });

    expect(candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: ".vscode", value: vscodePython, source: "vscode" }),
        expect.objectContaining({ value: localPython, source: "local" }),
        expect.objectContaining({ value: parentPython, source: "local" }),
        expect.objectContaining({ label: "environment.yml", value: "conda:workspace-api", source: "conda-file" }),
        expect.objectContaining({ value: terminalPython, source: "terminal" })
      ])
    );
  });
});

describe("validatePythonEnvironmentBinding", () => {
  it("accepts existing Python interpreter paths and conda bindings", async () => {
    await expect(
      validatePythonEnvironmentBinding("D:\\projects\\api", "D:\\envs\\api", {
        platform: "win32",
        fileExists: async (filePath) => filePath === "D:\\envs\\api\\Scripts\\python.exe"
      })
    ).resolves.toBeUndefined();

    await expect(
      validatePythonEnvironmentBinding("D:\\projects\\api", "conda:api-env", {
        platform: "win32",
        commandExists: async (name) => name === "conda"
      })
    ).resolves.toBeUndefined();
  });

  it("does not treat an environment directory itself as a Python executable", async () => {
    await expect(
      validatePythonEnvironmentBinding("D:\\projects\\api", "D:\\envs\\broken", {
        platform: "win32",
        fileExists: async (filePath) => filePath === "D:\\envs\\broken"
      })
    ).rejects.toThrow("找不到可用的 Python 解释器");
  });

  it("rejects malformed bindings before saving them", async () => {
    await expect(validatePythonEnvironmentBinding("D:\\projects\\api", "api-env", { platform: "win32" })).rejects.toThrow(
      "Python 环境请填写"
    );
    await expect(
      validatePythonEnvironmentBinding("D:\\projects\\api", "conda:", {
        platform: "win32",
        commandExists: async () => true
      })
    ).rejects.toThrow("Python 环境请填写");
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
