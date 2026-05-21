import path from "node:path";
import type { Command } from "@local-dev-cockpit/core";
import { type CommandResolutionOptions, fileExists, normalizeExecutableName } from "../shared.js";
import { resolveConfiguredProjectPythonInvocation } from "./binding.js";
import { findDeclaredCondaEnvironment } from "./conda.js";
import { findLocalPythonInterpreter, resolveInheritedPythonInvocation } from "./local-env.js";
import { candidateEnvironmentBases } from "./paths.js";
import { findPythonProjectRunner } from "./project-tools.js";
import { findConfiguredPythonInterpreter } from "./vscode.js";

export async function diagnosePythonDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const platform = options.platform ?? process.platform;
  const fileExistsFn = options.fileExists ?? fileExists;
  const hasDependencyManifest = await hasPythonDependencyManifest(command.cwd, fileExistsFn);
  if (!hasDependencyManifest) return undefined;
  if (await resolveConfiguredProjectPythonInvocation(command, normalizeExecutableName(command.command), platform, options)) return undefined;
  if (await findConfiguredPythonInterpreter(command.cwd, platform, options)) return undefined;
  if (await findLocalPythonInterpreter(command.cwd, platform, options.fileExists)) return undefined;
  if (await findDeclaredCondaEnvironment(command.cwd, options)) return undefined;
  if (await findPythonProjectRunner(command.cwd, platform, options)) return undefined;
  if (await resolveInheritedPythonInvocation(command, normalizeExecutableName(command.command), platform, options)) return undefined;

  return {
    summary: "Python 项目依赖环境未固定。",
    detail:
      "检测到 requirements.txt / pyproject.toml，但未找到 .venv、venv、conda 或 environment.yml。Dev Cockpit 会回退系统 Python；如果启动后缺包，请先创建或激活项目虚拟环境并安装依赖。桌面双击启动时无法读取另一个终端里的 conda activate 状态，建议在运行环境里绑定 conda:环境名 或 python.exe。"
  };
}

async function hasPythonDependencyManifest(
  projectPath: string,
  fileExistsFn: (filePath: string) => Promise<boolean>
): Promise<boolean> {
  for (const base of candidateEnvironmentBases(projectPath)) {
    for (const fileName of ["requirements.txt", "requirements-dev.txt", "pyproject.toml", "Pipfile", "poetry.lock"]) {
      if (await fileExistsFn(path.join(base, fileName))) return true;
    }
  }
  return false;
}
