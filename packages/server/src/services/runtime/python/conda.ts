import path from "node:path";
import {
  type CommandResolutionOptions,
  fileExists,
  isCommandAvailable,
  readTextFile,
  runExecFile
} from "../shared.js";
import { candidateEnvironmentBases, candidatePythonInterpreterPaths } from "./paths.js";
import type { DeclaredCondaEnvironment, PythonEnvironmentCandidate } from "./types.js";

export async function discoverCondaEnvironmentCandidates(
  projectPath: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<PythonEnvironmentCandidate[]> {
  if (!(await isCommandAvailable("conda", platform, options.commandExists))) return [];
  const result = await runExecFile("conda", ["env", "list", "--json"], platform, options, 3500);
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];
  const envPaths = parseCondaEnvironmentPaths(result.stdout);
  const fileExistsFn = options.fileExists ?? fileExists;
  const candidates: PythonEnvironmentCandidate[] = [];

  for (const envPath of envPaths) {
    for (const pythonPath of candidatePythonInterpreterPaths(envPath, platform)) {
      if (await fileExistsFn(pythonPath)) {
        const envName = condaEnvironmentNameFromPath(envPath);
        candidates.push({
          id: `conda-list:${pythonPath}`,
          label: `Conda: ${envName}`,
          value: pythonPath,
          source: "conda-list",
          detail: envPath
        });
        break;
      }
    }
  }

  const projectTokens = projectEnvironmentMatchTokens(projectPath);
  return candidates
    .map((candidate) => ({ candidate, score: scoreCondaCandidate(candidate, projectTokens) }))
    .sort((left, right) => right.score - left.score || left.candidate.label.localeCompare(right.candidate.label))
    .slice(0, 10)
    .map((item) => item.candidate);
}

export async function findDeclaredCondaEnvironment(
  projectPath: string,
  options: CommandResolutionOptions
): Promise<DeclaredCondaEnvironment | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  const readFileFn = options.readFile ?? readTextFile;
  for (const base of candidateEnvironmentBases(projectPath)) {
    for (const fileName of ["environment.yml", "environment.yaml"]) {
      const filePath = path.join(base, fileName);
      if (!(await fileExistsFn(filePath))) continue;
      const raw = await readFileFn(filePath);
      const name = parseCondaEnvironmentName(raw);
      if (name) return { name, filePath };
    }
  }
  return undefined;
}

export function parseCondaEnvironmentPaths(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as { envs?: unknown };
    if (!Array.isArray(parsed.envs)) return [];
    return parsed.envs
      .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
      .map((item) => path.resolve(item.trim()));
  } catch {
    return [];
  }
}

function parseCondaEnvironmentName(raw: string): string | undefined {
  const match = raw.match(/^\s*name\s*:\s*([^\r\n#]+)/m);
  const name = match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  if (!name || name.toLowerCase() === "base") return undefined;
  return name;
}

function condaEnvironmentNameFromPath(envPath: string): string {
  const normalized = path.resolve(envPath);
  const parent = path.basename(path.dirname(normalized)).toLowerCase();
  if (parent === "envs") return path.basename(normalized);
  return path.basename(normalized) || "base";
}

function projectEnvironmentMatchTokens(projectPath: string): string[] {
  return path
    .basename(projectPath)
    .toLowerCase()
    .split(/[^a-z0-9]+/i)
    .filter((token) => token.length >= 3);
}

function scoreCondaCandidate(candidate: PythonEnvironmentCandidate, projectTokens: string[]): number {
  const haystack = `${candidate.label} ${candidate.value} ${candidate.detail}`.toLowerCase();
  return projectTokens.reduce((score, token) => score + (haystack.includes(token) ? 2 : 0), 0);
}
