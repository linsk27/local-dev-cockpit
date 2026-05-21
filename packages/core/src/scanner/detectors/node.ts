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
  return readPackageScripts(projectPath, packageManager ?? "npm", fs);
}

async function readPackageScripts(projectPath: string, packageManager: NonNullable<Project["packageManager"]>, fs: FileSystemAdapter): Promise<Command[]> {
  try {
    const raw = await fs.readFile(path.join(projectPath, "package.json"));
    const parsed = parseJsonText<{ scripts?: Record<string, string> }>(raw);
    return Object.entries(parsed.scripts ?? {}).map(([scriptName, scriptBody]) => {
      return command(
        `script-${scriptName}`,
        scriptName,
        packageManager,
        buildPackageScriptArgs(packageManager, scriptName, scriptBody),
        projectPath,
        "package-script",
        inferCommandKind(scriptName),
        extractPortNumbersFromText(scriptBody)
      );
    });
  } catch {
    return [];
  }
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
