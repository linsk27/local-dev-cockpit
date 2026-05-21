import type { Command } from "@local-dev-cockpit/core";
import {
  type CommandResolutionOptions,
  type SpawnInvocation,
  createSpawnInvocation,
  isCommandAvailable
} from "../shared.js";
import { resolveConfiguredProjectPythonInvocation } from "./binding.js";
import { findDeclaredCondaEnvironment } from "./conda.js";
import { findLocalPythonInterpreter, resolveInheritedPythonInvocation } from "./local-env.js";
import { findPythonProjectRunner } from "./project-tools.js";
import { findConfiguredPythonInterpreter } from "./vscode.js";

export async function resolvePythonInvocation(
  command: Command,
  lowerCommand: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<SpawnInvocation | undefined> {
  const configuredProjectInvocation = await resolveConfiguredProjectPythonInvocation(command, lowerCommand, platform, options);
  if (configuredProjectInvocation) return configuredProjectInvocation;

  const configuredInterpreter = await findConfiguredPythonInterpreter(command.cwd, platform, options);
  if (configuredInterpreter) {
    return {
      ...createSpawnInvocation(configuredInterpreter.path, command.args, platform),
      note: `已使用编辑器配置的 Python 环境：${configuredInterpreter.label}。`
    };
  }

  const localInterpreter = await findLocalPythonInterpreter(command.cwd, platform, options.fileExists);
  if (localInterpreter) {
    return {
      ...createSpawnInvocation(localInterpreter.path, command.args, platform),
      note: `已使用项目 Python 环境：${localInterpreter.label}。`
    };
  }

  const condaEnvironment = await findDeclaredCondaEnvironment(command.cwd, options);
  if (condaEnvironment && (await isCommandAvailable("conda", platform, options.commandExists))) {
    const pythonCommand = lowerCommand === "py" ? "python" : command.command;
    return {
      ...createSpawnInvocation("conda", ["run", "-n", condaEnvironment.name, pythonCommand, ...command.args], platform),
      note: `已通过 Conda 环境 ${condaEnvironment.name} 运行；来源：${condaEnvironment.filePath}。`
    };
  }

  const projectRunner = await findPythonProjectRunner(command.cwd, platform, options);
  if (projectRunner) {
    const pythonCommand = lowerCommand === "py" ? "python" : command.command;
    return {
      ...createSpawnInvocation(projectRunner.command, [...projectRunner.argsPrefix, pythonCommand, ...command.args], platform),
      note: `已通过 ${projectRunner.label} 运行 Python 命令；来源：${projectRunner.filePath}。`
    };
  }

  const inheritedInvocation = await resolveInheritedPythonInvocation(command, lowerCommand, platform, options);
  if (inheritedInvocation) return inheritedInvocation;

  if (await isCommandAvailable(command.command, platform, options.commandExists)) return undefined;
  if (platform === "win32" && lowerCommand !== "py" && (await isCommandAvailable("py", platform, options.commandExists))) {
    return {
      ...createSpawnInvocation("py", command.args, platform),
      note: "未找到项目虚拟环境，已使用 Windows Python Launcher。"
    };
  }

  throw new Error("未找到可用的 Python。请在项目中创建 .venv/venv/.conda，或安装 Python/Conda 后再运行。");
}
