import path from "node:path";
import {
  type CommandResolutionOptions,
  fileExists,
  isPathLikeCommand,
  readTextFile
} from "../shared.js";
import { candidateEnvironmentBases, candidatePythonInterpreterPaths, describeEnvironmentPath, expandConfiguredPath } from "./paths.js";
import type { ConfiguredPythonInterpreter } from "./types.js";

export async function findConfiguredPythonInterpreter(
  projectPath: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<ConfiguredPythonInterpreter | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  const readFileFn = options.readFile ?? readTextFile;
  for (const base of candidateEnvironmentBases(projectPath)) {
    const settingsPath = path.join(base, ".vscode", "settings.json");
    if (!(await fileExistsFn(settingsPath))) continue;
    const settings = await readJsonObjectWithComments(settingsPath, readFileFn);
    if (!settings) continue;
    for (const key of ["python.defaultInterpreterPath", "python.pythonPath"]) {
      const rawValue = settings[key];
      if (typeof rawValue !== "string" || rawValue.trim().length === 0) continue;
      const interpreterPath = await resolveConfiguredPythonPath(rawValue, base, platform, fileExistsFn);
      if (interpreterPath) {
        const settingsLabel = path.relative(projectPath, settingsPath);
        return {
          path: interpreterPath,
          label: `${describeEnvironmentPath(projectPath, interpreterPath)} (${settingsLabel})`
        };
      }
    }
  }
  return undefined;
}

async function resolveConfiguredPythonPath(
  rawValue: string,
  workspacePath: string,
  platform: NodeJS.Platform,
  fileExistsFn: (filePath: string) => Promise<boolean>
): Promise<string | undefined> {
  const expanded = expandConfiguredPath(rawValue, workspacePath).trim();
  if (!expanded || !isPathLikeCommand(expanded)) return undefined;
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(workspacePath, expanded);
  for (const pythonPath of candidatePythonInterpreterPaths(candidate, platform)) {
    if (await fileExistsFn(pythonPath)) return pythonPath;
  }
  return undefined;
}

async function readJsonObjectWithComments(
  filePath: string,
  readFileFn: (filePath: string) => Promise<string>
): Promise<Record<string, unknown> | undefined> {
  try {
    const parsed = JSON.parse(stripJsonComments(await readFileFn(filePath)));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function stripJsonComments(raw: string): string {
  return raw
    .replace(/^\uFEFF/, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1")
    .replace(/,\s*([}\]])/g, "$1");
}
