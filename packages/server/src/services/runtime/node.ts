import path from "node:path";
import type { Command } from "@local-dev-cockpit/core";
import {
  COREPACK_MANAGERS,
  PACKAGE_MANAGER_COMMANDS,
  type CommandResolutionOptions,
  type SpawnInvocation,
  createSpawnInvocation,
  fileExists,
  hasAnyFile,
  isCommandAvailable,
  isPackageManagerAvailable,
  normalizeExecutableName,
  readTextFile
} from "./shared.js";

export async function diagnoseNodeDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  if (!isPackageManagerScriptCommand(command)) return undefined;
  const fileExistsFn = options.fileExists ?? fileExists;
  const readFileFn = options.readFile ?? readTextFile;
  const packageJsonPath = path.join(command.cwd, "package.json");
  if (!(await fileExistsFn(packageJsonPath))) return undefined;

  const hasDependencies = await packageJsonHasDependencies(packageJsonPath, readFileFn);
  if (!hasDependencies) return undefined;

  if (await hasNodeModulesInResolutionPath(command.cwd, fileExistsFn)) return undefined;

  const installCommand = packageInstallCommand(command);
  const workspaceRoot = await findNodeWorkspaceRoot(command.cwd, fileExistsFn, readFileFn);
  const installHint =
    workspaceRoot && path.resolve(workspaceRoot) !== path.resolve(command.cwd)
      ? `检测到工作区根目录：${formatPathHint(workspaceRoot, command.cwd)}。建议在工作区根目录执行：${installCommand}。`
      : `首次运行前建议执行：${installCommand}。`;
  return {
    summary: "项目依赖可能尚未安装。",
    detail: `检测到 package.json 声明了依赖，但当前目录及父级目录都没有 node_modules。${installHint}`
  };
}

async function hasNodeModulesInResolutionPath(
  projectPath: string,
  fileExistsFn: (filePath: string) => Promise<boolean>
): Promise<boolean> {
  let current = path.resolve(projectPath);
  while (true) {
    if (await fileExistsFn(path.join(current, "node_modules"))) return true;
    const parent = path.dirname(current);
    if (parent === current) return false;
    current = parent;
  }
}

async function findNodeWorkspaceRoot(
  projectPath: string,
  fileExistsFn: (filePath: string) => Promise<boolean>,
  readFileFn: (filePath: string) => Promise<string>
): Promise<string | undefined> {
  let current = path.resolve(projectPath);
  while (true) {
    if (await hasAnyFile(current, ["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "rush.json"], fileExistsFn)) {
      return current;
    }

    const packageJsonPath = path.join(current, "package.json");
    if ((await fileExistsFn(packageJsonPath)) && (await packageJsonDeclaresWorkspaces(packageJsonPath, readFileFn))) {
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

async function packageJsonDeclaresWorkspaces(packageJsonPath: string, readFileFn: (filePath: string) => Promise<string>): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFileFn(packageJsonPath)) as { workspaces?: unknown };
    return Array.isArray(parsed.workspaces) || hasPackageEntries(parsed.workspaces);
  } catch {
    return false;
  }
}

function formatPathHint(targetPath: string, basePath: string): string {
  const relative = path.relative(basePath, targetPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : targetPath;
}

function packageInstallCommand(command: Command): string {
  switch (normalizeExecutableName(command.command)) {
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    case "bun":
      return "bun install";
    case "npm":
    default:
      return "npm install";
  }
}

function isPackageManagerScriptCommand(command: Command): boolean {
  const normalized = normalizeExecutableName(command.command);
  if (!PACKAGE_MANAGER_COMMANDS.has(normalized)) return false;
  if (normalized === "npm" || normalized === "pnpm" || normalized === "yarn") return command.args[0] === "run" && Boolean(command.args[1]);
  if (normalized === "bun") return command.args[0] === "run" && Boolean(command.args[1]);
  return false;
}

async function packageJsonHasDependencies(
  packageJsonPath: string,
  readFileFn: (filePath: string) => Promise<string>
): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFileFn(packageJsonPath)) as Record<string, unknown>;
    return ["dependencies", "devDependencies", "optionalDependencies", "peerDependencies"].some((field) =>
      hasPackageEntries(parsed[field])
    );
  } catch {
    return false;
  }
}

function hasPackageEntries(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length > 0);
}

export async function resolvePackageManagerFallback(
  command: Command,
  packageManager: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<SpawnInvocation | undefined> {
  if (COREPACK_MANAGERS.has(packageManager) && (await isCommandAvailable("corepack", platform, options.commandExists))) {
    return {
      ...createSpawnInvocation("corepack", [packageManager, ...command.args], platform),
      note: `${packageManager} 未安装，已通过 corepack 尝试运行。`
    };
  }

  const packageLockPath = path.join(command.cwd, "package-lock.json");
  const hasPackageLock = options.fileExists ? await options.fileExists(packageLockPath) : await fileExists(packageLockPath);
  if (packageManager !== "npm" && hasPackageLock && (await isPackageManagerAvailable("npm", platform, options.commandExists))) {
    return {
      ...createSpawnInvocation("npm", toNpmRunArgs(command.args), platform),
      note: `${packageManager} 未安装，且项目存在 package-lock.json，已改用 npm 运行该脚本。`
    };
  }

  return undefined;
}

export function toNpmRunArgs(args: string[]): string[] {
  if (args[0] !== "run" || !args[1]) return args;
  const scriptArgs = args.slice(2);
  if (scriptArgs.length === 0 || scriptArgs[0] === "--") return args;
  return ["run", args[1], "--", ...scriptArgs];
}
