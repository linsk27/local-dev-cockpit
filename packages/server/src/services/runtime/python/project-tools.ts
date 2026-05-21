import path from "node:path";
import {
  type CommandResolutionOptions,
  fileExists,
  isCommandAvailable,
  readTextFile
} from "../shared.js";
import { candidateEnvironmentBases } from "./paths.js";
import type { PythonProjectRunner } from "./types.js";

export async function findPythonProjectRunner(
  projectPath: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<PythonProjectRunner | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  const readFileFn = options.readFile ?? readTextFile;

  for (const base of candidateEnvironmentBases(projectPath)) {
    const uvLockPath = path.join(base, "uv.lock");
    if ((await fileExistsFn(uvLockPath)) && (await isCommandAvailable("uv", platform, options.commandExists))) {
      return { command: "uv", argsPrefix: ["run"], label: "uv", filePath: uvLockPath };
    }

    const poetryLockPath = path.join(base, "poetry.lock");
    if ((await fileExistsFn(poetryLockPath)) && (await isCommandAvailable("poetry", platform, options.commandExists))) {
      return { command: "poetry", argsPrefix: ["run"], label: "Poetry", filePath: poetryLockPath };
    }

    const pyprojectPath = path.join(base, "pyproject.toml");
    if (
      (await fileExistsFn(pyprojectPath)) &&
      (await pyprojectUsesPoetry(pyprojectPath, readFileFn)) &&
      (await isCommandAvailable("poetry", platform, options.commandExists))
    ) {
      return { command: "poetry", argsPrefix: ["run"], label: "Poetry", filePath: pyprojectPath };
    }

    const pipfilePath = path.join(base, "Pipfile");
    if ((await fileExistsFn(pipfilePath)) && (await isCommandAvailable("pipenv", platform, options.commandExists))) {
      return { command: "pipenv", argsPrefix: ["run"], label: "Pipenv", filePath: pipfilePath };
    }
  }

  return undefined;
}

async function pyprojectUsesPoetry(pyprojectPath: string, readFileFn: (filePath: string) => Promise<string>): Promise<boolean> {
  try {
    return /^\s*\[tool\.poetry\]\s*$/m.test(await readFileFn(pyprojectPath));
  } catch {
    return false;
  }
}
