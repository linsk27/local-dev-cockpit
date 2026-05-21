import { type CommandResolutionOptions, fileExists } from "../shared.js";
import { discoverCondaEnvironmentCandidates, findDeclaredCondaEnvironment } from "./conda.js";
import { findLocalPythonInterpreters } from "./local-env.js";
import { candidatePythonInterpreterPaths } from "./paths.js";
import type { PythonEnvironmentCandidate } from "./types.js";
import { findConfiguredPythonInterpreter } from "./vscode.js";

export async function discoverPythonEnvironmentCandidates(
  projectPath: string,
  options: CommandResolutionOptions = {}
): Promise<PythonEnvironmentCandidate[]> {
  const platform = options.platform ?? process.platform;
  const candidates: PythonEnvironmentCandidate[] = [];
  const configured = await findConfiguredPythonInterpreter(projectPath, platform, options);
  if (configured) {
    candidates.push({
      id: `vscode:${configured.path}`,
      label: ".vscode",
      value: configured.path,
      source: "vscode",
      detail: configured.label
    });
  }

  for (const local of await findLocalPythonInterpreters(projectPath, platform, options.fileExists)) {
    candidates.push({
      id: `local:${local.path}`,
      label: local.label.includes("..") ? "父级虚拟环境" : "项目虚拟环境",
      value: local.path,
      source: "local",
      detail: local.label
    });
  }

  const condaEnvironment = await findDeclaredCondaEnvironment(projectPath, options);
  if (condaEnvironment) {
    candidates.push({
      id: `conda-file:${condaEnvironment.name}`,
      label: "environment.yml",
      value: `conda:${condaEnvironment.name}`,
      source: "conda-file",
      detail: condaEnvironment.filePath
    });
  }

  const env = options.env ?? process.env;
  const inherited = env.VIRTUAL_ENV || env.CONDA_PREFIX;
  if (inherited) {
    for (const pythonPath of candidatePythonInterpreterPaths(inherited, platform)) {
      if (await (options.fileExists ?? fileExists)(pythonPath)) {
        candidates.push({
          id: `terminal:${pythonPath}`,
          label: env.CONDA_PREFIX ? "当前终端 Conda" : "当前终端虚拟环境",
          value: pythonPath,
          source: "terminal",
          detail: pythonPath
        });
        break;
      }
    }
  }

  const condaName = env.CONDA_DEFAULT_ENV?.trim();
  if (condaName && condaName.toLowerCase() !== "base") {
    candidates.push({
      id: `terminal-conda:${condaName}`,
      label: "当前终端 Conda",
      value: `conda:${condaName}`,
      source: "terminal",
      detail: condaName
    });
  }

  candidates.push(...(await discoverCondaEnvironmentCandidates(projectPath, platform, options)));

  return uniquePythonCandidates(candidates);
}

function uniquePythonCandidates(candidates: PythonEnvironmentCandidate[]): PythonEnvironmentCandidate[] {
  const seen = new Set<string>();
  const unique: PythonEnvironmentCandidate[] = [];
  for (const candidate of candidates) {
    const key = candidate.value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}
