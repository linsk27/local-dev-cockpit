import path from "node:path";
import type { Command } from "@local-dev-cockpit/core";
import type { FailureRule } from "./types.js";
import { formatShellToken, isPathLikeCommand, normalizeExecutableName } from "./utils.js";

const PYTHON_COMMANDS = new Set(["python", "python3", "py"]);

export const summarizePythonFailure: FailureRule = ({ rawLog, exitCode, command }) => {
  const pythonMissingModule = rawLog.match(/ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/i);
  if (!pythonMissingModule?.[1]) return undefined;

  const moduleName = pythonMissingModule[1];
  const packageName = pythonPackageInstallName(moduleName);
  const installCommand = pythonInstallCommand(packageName, rawLog, command);
  return [
    `缺少 Python 依赖：${moduleName}。`,
    `请在该项目当前 Python 环境中安装：${installCommand}。`,
    "如果项目有 requirements.txt / pyproject.toml，请先同步依赖；如果依赖已经安装过，通常是 Dev Cockpit、终端或 IDE 使用的 Python 环境不一致。",
    "Conda 项目请在项目详情的运行环境中选择检测到的 Conda 候选，或填写 conda:环境名；如果习惯从终端运行，也可以先 conda activate 后再从同一终端启动 npx local-dev-cockpit。",
    `(exit code ${exitCode ?? "unknown"})`
  ].join(" ");
};

function pythonPackageInstallName(moduleName: string): string {
  const rootModule = moduleName.split(".")[0]?.trim() ?? moduleName;
  const knownMappings: Record<string, string> = {
    PIL: "Pillow",
    cv2: "opencv-python",
    dotenv: "python-dotenv",
    jwt: "PyJWT",
    sklearn: "scikit-learn",
    yaml: "PyYAML"
  };
  return knownMappings[rootModule] ?? rootModule;
}

function pythonInstallCommand(packageName: string, rawLog: string, command?: Command): string {
  const condaName = pythonCondaEnvironmentFromFailure(rawLog, command);
  if (condaName) return `conda run -n ${formatShellToken(condaName)} python -m pip install ${packageName}`;

  const runner = pythonProjectRunnerFromFailure(rawLog);
  if (runner === "uv") return `uv add ${packageName}`;
  if (runner === "poetry") return `poetry add ${packageName}`;
  if (runner === "pipenv") return `pipenv install ${packageName}`;

  const interpreter = pythonInterpreterFromFailure(rawLog, command);
  if (interpreter) return `${formatShellToken(interpreter)} -m pip install ${packageName}`;

  return `python -m pip install ${packageName}`;
}

function pythonCondaEnvironmentFromFailure(rawLog: string, command?: Command): string | undefined {
  const fromLog = [
    /已使用项目绑定的 Conda 环境[:：]\s*([^。\s]+)/i,
    /已通过 Conda 环境\s+([^。\s]+)\s+运行/i,
    /已通过当前终端 Conda 环境\s+([^。\s]+)\s+运行/i
  ]
    .map((pattern) => rawLog.match(pattern)?.[1]?.trim())
    .find(Boolean);
  if (fromLog) return fromLog;

  if (command && normalizeExecutableName(command.command) === "conda") {
    const nameFlagIndex = command.args.findIndex((arg) => arg === "-n" || arg === "--name");
    const envName = nameFlagIndex >= 0 ? command.args[nameFlagIndex + 1]?.trim() : undefined;
    if (envName) return envName;
  }

  return undefined;
}

function pythonProjectRunnerFromFailure(rawLog: string): "uv" | "poetry" | "pipenv" | undefined {
  const runner = rawLog.match(/已通过\s+(uv|poetry|pipenv)\s+运行 Python 命令/i)?.[1]?.toLowerCase();
  if (runner === "uv" || runner === "poetry" || runner === "pipenv") return runner;
  return undefined;
}

function pythonInterpreterFromFailure(rawLog: string, command?: Command): string | undefined {
  if (command && PYTHON_COMMANDS.has(normalizeExecutableName(command.command)) && isPathLikeCommand(command.command)) {
    return command.command;
  }

  const rawInterpreter = [
    /已使用项目 Python 环境[:：]\s*([^。]+)/i,
    /已使用编辑器配置的 Python 环境[:：]\s*([^。]+)/i,
    /已使用当前终端(?:Conda 环境|虚拟环境)[:：]\s*([^。]+)/i,
    /已使用项目绑定的 Python 环境[:：]\s*([^。]+)/i
  ]
    .map((pattern) => rawLog.match(pattern)?.[1]?.trim())
    .find(Boolean);
  if (!rawInterpreter) return undefined;

  const cleaned = rawInterpreter.replace(/\s+\([^)]*\)\s*$/, "").trim();
  if (!cleaned) return undefined;
  if (path.isAbsolute(cleaned) || !command?.cwd) return cleaned;
  return path.resolve(command.cwd, cleaned);
}
