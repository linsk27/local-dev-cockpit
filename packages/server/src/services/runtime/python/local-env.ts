import path from "node:path";
import { type Command } from "@local-dev-cockpit/core";
import { type CommandResolutionOptions, type SpawnInvocation, createSpawnInvocation, fileExists, isCommandAvailable } from "../shared.js";
import { candidateEnvironmentBases, candidatePythonInterpreterPaths, describeEnvironmentPath } from "./paths.js";
import type { LocalPythonInterpreter } from "./types.js";

export async function findLocalPythonInterpreter(
  projectPath: string,
  platform: NodeJS.Platform,
  fileExistsOverride?: (filePath: string) => Promise<boolean>
): Promise<LocalPythonInterpreter | undefined> {
  return (await findLocalPythonInterpreters(projectPath, platform, fileExistsOverride))[0];
}

export async function findLocalPythonInterpreters(
  projectPath: string,
  platform: NodeJS.Platform,
  fileExistsOverride?: (filePath: string) => Promise<boolean>
): Promise<LocalPythonInterpreter[]> {
  const fileExistsFn = fileExistsOverride ?? fileExists;
  const bases = candidateEnvironmentBases(projectPath);
  const envNames = [".venv", "venv", ".env", "env", ".conda", "conda"];
  const relativeInterpreters =
    platform === "win32"
      ? ["Scripts/python.exe", "python.exe"]
      : ["bin/python", "python"];
  const interpreters: LocalPythonInterpreter[] = [];

  for (const base of bases) {
    for (const envName of envNames) {
      for (const relativeInterpreter of relativeInterpreters) {
        const interpreterPath = path.join(base, envName, relativeInterpreter);
        if (await fileExistsFn(interpreterPath)) {
          interpreters.push({ path: interpreterPath, label: describeEnvironmentPath(projectPath, interpreterPath) });
          break;
        }
      }
    }
  }
  return interpreters;
}

export async function resolveInheritedPythonInvocation(
  command: Command,
  lowerCommand: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<SpawnInvocation | undefined> {
  const env = options.env ?? process.env;
  const fileExistsFn = options.fileExists ?? fileExists;
  const activeEnvPath = env.VIRTUAL_ENV || env.CONDA_PREFIX;
  if (activeEnvPath) {
    const label = env.CONDA_PREFIX ? "当前终端 Conda 环境" : "当前终端虚拟环境";
    for (const pythonPath of candidatePythonInterpreterPaths(activeEnvPath, platform)) {
      if (await fileExistsFn(pythonPath)) {
        return {
          ...createSpawnInvocation(pythonPath, command.args, platform),
          note: `已使用${label}：${pythonPath}。`
        };
      }
    }
  }

  const condaName = env.CONDA_DEFAULT_ENV?.trim();
  if (condaName && condaName.toLowerCase() !== "base" && (await isCommandAvailable("conda", platform, options.commandExists))) {
    const pythonCommand = lowerCommand === "py" ? "python" : command.command;
    return {
      ...createSpawnInvocation("conda", ["run", "-n", condaName, pythonCommand, ...command.args], platform),
      note: `已通过当前终端 Conda 环境 ${condaName} 运行。`
    };
  }

  return undefined;
}
