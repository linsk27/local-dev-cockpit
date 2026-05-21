import path from "node:path";
import type { Command } from "@local-dev-cockpit/core";
import {
  type CommandResolutionOptions,
  type SpawnInvocation,
  createSpawnInvocation,
  fileExists,
  isCommandAvailable,
  isPathLikeCommand
} from "../shared.js";
import { candidatePythonInterpreterPaths, expandConfiguredPath } from "./paths.js";

export async function validatePythonEnvironmentBinding(
  projectPath: string,
  rawValue: string,
  options: CommandResolutionOptions = {}
): Promise<void> {
  const value = rawValue.trim();
  if (!value) return;
  const platform = options.platform ?? process.platform;
  const condaMatch = value.match(/^conda:(.+)$/i);
  if (condaMatch) {
    const envName = condaMatch[1]?.trim();
    if (!envName) throw new Error("Conda 环境名为空。请填写 conda:环境名。");
    if (!/^[\w.\-]+$/.test(envName)) {
      throw new Error("Conda 环境名包含异常字符。请填写类似 conda:api-env 的格式。");
    }
    if (!(await isCommandAvailable("conda", platform, options.commandExists))) {
      throw new Error(`本机找不到 conda，无法使用 ${value}。`);
    }
    return;
  }

  const expanded = expandConfiguredPath(value, projectPath).trim();
  if (!expanded || !isPathLikeCommand(expanded)) {
    throw new Error("Python 环境请填写 conda:环境名、python.exe 路径或虚拟环境目录。");
  }
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(projectPath, expanded);
  const fileExistsFn = options.fileExists ?? fileExists;
  for (const pythonPath of candidatePythonInterpreterPaths(candidate, platform)) {
    if (await fileExistsFn(pythonPath)) return;
  }
  throw new Error(`找不到可用的 Python 解释器：${value}`);
}

export async function resolveConfiguredProjectPythonInvocation(
  command: Command,
  lowerCommand: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<SpawnInvocation | undefined> {
  const rawValue = options.projectEnvironment?.python?.trim();
  if (!rawValue) return undefined;
  const condaMatch = rawValue.match(/^conda:(.+)$/i);
  if (condaMatch) {
    const envName = condaMatch[1]?.trim();
    if (!envName) throw new Error("项目绑定的 Conda 环境名为空。");
    if (!(await isCommandAvailable("conda", platform, options.commandExists))) {
      throw new Error(`项目绑定了 Conda 环境 ${envName}，但本机找不到 conda。`);
    }
    const pythonCommand = lowerCommand === "py" ? "python" : command.command;
    return {
      ...createSpawnInvocation("conda", ["run", "-n", envName, pythonCommand, ...command.args], platform),
      note: `已使用项目绑定的 Conda 环境：${envName}。`
    };
  }

  const fileExistsFn = options.fileExists ?? fileExists;
  const expanded = expandConfiguredPath(rawValue, command.cwd).trim();
  if (!expanded) return undefined;
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(command.cwd, expanded);
  for (const pythonPath of candidatePythonInterpreterPaths(candidate, platform)) {
    if (await fileExistsFn(pythonPath)) {
      return {
        ...createSpawnInvocation(pythonPath, command.args, platform),
        note: `已使用项目绑定的 Python 环境：${pythonPath}。`
      };
    }
  }
  throw new Error(`项目绑定的 Python 环境不存在：${rawValue}`);
}
