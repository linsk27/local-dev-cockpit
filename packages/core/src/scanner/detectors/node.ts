import path from "node:path";
import type { FileSystemAdapter } from "../../adapters.js";
import type { Command, Project } from "../../types.js";
import { command, extractPortNumbersFromText, inferCommandKind, parseJsonText } from "./common.js";

export async function detectPackageManager(projectPath: string, fs: FileSystemAdapter): Promise<Project["packageManager"]> {
  const declared = await readDeclaredPackageManager(projectPath, fs);
  if (declared) return declared;

  if (await fs.exists(path.join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if ((await fs.exists(path.join(projectPath, "bun.lockb"))) || (await fs.exists(path.join(projectPath, "bun.lock")))) return "bun";
  if (await fs.exists(path.join(projectPath, "package-lock.json"))) return "npm";
  if (await fs.exists(path.join(projectPath, "yarn.lock"))) return "yarn";
  if (await fs.exists(path.join(projectPath, "package.json"))) return "npm";
  return undefined;
}

async function readDeclaredPackageManager(projectPath: string, fs: FileSystemAdapter): Promise<Project["packageManager"]> {
  try {
    const raw = await fs.readFile(path.join(projectPath, "package.json"));
    const parsed = parseJsonText<{ packageManager?: string }>(raw);
    const manager = parsed.packageManager?.split("@")[0]?.trim();
    return manager === "npm" || manager === "pnpm" || manager === "yarn" || manager === "bun" ? manager : undefined;
  } catch {
    return undefined;
  }
}

export async function detectNodeCommands(projectPath: string, packageManager: Project["packageManager"], fs: FileSystemAdapter): Promise<Command[]> {
  const configuredPorts = await detectNodeDevServerPorts(projectPath, fs);
  return readPackageScripts(projectPath, packageManager ?? "npm", fs, configuredPorts);
}

async function readPackageScripts(
  projectPath: string,
  packageManager: NonNullable<Project["packageManager"]>,
  fs: FileSystemAdapter,
  configuredPorts: number[]
): Promise<Command[]> {
  try {
    const raw = await fs.readFile(path.join(projectPath, "package.json"));
    const parsed = parseJsonText<{ scripts?: Record<string, string> }>(raw);
    return Object.entries(parsed.scripts ?? {}).map(([scriptName, scriptBody]) => {
      const scriptPorts = extractPortNumbersFromText(scriptBody);
      const ports = shouldUseConfiguredDevServerPorts(scriptName, scriptBody) ? uniquePorts([...scriptPorts, ...configuredPorts]) : scriptPorts;
      return command(
        `script-${scriptName}`,
        scriptName,
        packageManager,
        buildPackageScriptArgs(packageManager, scriptName, scriptBody),
        projectPath,
        "package-script",
        inferCommandKind(scriptName),
        ports
      );
    });
  } catch {
    return [];
  }
}

async function detectNodeDevServerPorts(projectPath: string, fs: FileSystemAdapter): Promise<number[]> {
  const ports = new Set<number>();
  for (const configName of ["vite.config.js", "vite.config.ts", "vite.config.mjs", "vite.config.cjs", "vite.config.mts", "vite.config.cts"]) {
    await collectConfigPorts(path.join(projectPath, configName), fs, ports);
  }
  await collectConfigPorts(path.join(projectPath, "vue.config.js"), fs, ports);
  await collectConfigPorts(path.join(projectPath, "vue.config.ts"), fs, ports);
  return [...ports];
}

async function collectConfigPorts(configPath: string, fs: FileSystemAdapter, ports: Set<number>): Promise<void> {
  if (!(await fs.exists(configPath))) return;
  try {
    const source = stripComments(await fs.readFile(configPath));
    for (const port of extractConfiguredPorts(source)) ports.add(port);
  } catch {
    // Configuration files are user code. If one cannot be read, keep the scan best-effort.
  }
}

function extractConfiguredPorts(source: string): number[] {
  const ports = new Set<number>();
  for (const match of source.matchAll(/\b(?:server|devServer)\s*:\s*\{[\s\S]{0,2000}?\bport\s*:\s*(\d{2,5})/g)) {
    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port);
  }
  return [...ports];
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function shouldUseConfiguredDevServerPorts(scriptName: string, scriptBody: string): boolean {
  if (!/(dev|serve|preview|start)/i.test(scriptName)) return false;
  return /\b(vite|vue-cli-service|webpack-dev-server|next)\b/i.test(scriptBody);
}

function uniquePorts(ports: number[]): number[] {
  return [...new Set(ports)];
}

function buildPackageScriptArgs(packageManager: NonNullable<Project["packageManager"]>, scriptName: string, scriptBody: string): string[] {
  const args = ["run", scriptName];
  if (!shouldForceBrowserReachableHost(scriptName, scriptBody)) return args;
  return packageManager === "npm" ? [...args, "--", "--host", "127.0.0.1"] : [...args, "--host", "127.0.0.1"];
}

function shouldForceBrowserReachableHost(scriptName: string, scriptBody: string): boolean {
  if (!/(dev|serve|preview|start)/i.test(scriptName)) return false;
  const normalized = scriptBody.toLowerCase();
  if (!/(^|\s|["'])vite(\s|$|["'])/.test(normalized)) return false;
  return !/(^|\s)--host(?:\s|=|$)/.test(normalized);
}
