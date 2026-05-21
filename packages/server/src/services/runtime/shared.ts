import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

export const WINDOWS_CMD_SHIMS = new Set(["npm", "npx", "pnpm", "yarn", "bun", "corepack"]);
export const WINDOWS_PATHEXT_SHIMS = new Set(["bundle", "composer", "conda", "dotnet", "gradle", "mvn", "php", "pipenv", "poetry", "ruby", "uv"]);
export const PACKAGE_MANAGER_COMMANDS = new Set(["npm", "npx", "pnpm", "yarn", "bun"]);
export const COREPACK_MANAGERS = new Set(["pnpm", "yarn"]);
export const PYTHON_COMMANDS = new Set(["python", "python3", "py"]);
export const JAVA_BUILD_COMMANDS = new Set(["mvn", "mvnw", "gradle", "gradlew"]);
export const VERIFIED_RUNTIME_COMMANDS = new Set(["bundle", "composer", "docker", "dotnet", "go", "gradle", "mvn", "php", "ruby", "cargo"]);
const execFileAsync = promisify(execFile);

export interface SpawnInvocation {
  command: string;
  args: string[];
  note?: string;
}

export interface CommandEnvironmentDiagnostic {
  commandId: string;
  label: string;
  status: "ready" | "warn" | "missing";
  summary: string;
  detail: string;
  resolvedCommand?: string;
}

export interface CommandResolutionOptions {
  platform?: NodeJS.Platform;
  commandExists?: (command: string, platform: NodeJS.Platform) => Promise<boolean>;
  execFile?: (command: string, args: string[], options?: { timeoutMs?: number; env?: NodeJS.ProcessEnv }) => Promise<{ stdout: string; stderr: string; exitCode: number }>;
  fileExists?: (filePath: string) => Promise<boolean>;
  readFile?: (filePath: string) => Promise<string>;
  env?: NodeJS.ProcessEnv;
  projectEnvironment?: {
    python?: string;
  };
}

export function createSpawnInvocation(command: string, args: string[], platform: NodeJS.Platform): SpawnInvocation {
  if (platform !== "win32") return { command, args };
  const lower = command.toLowerCase();
  if (!WINDOWS_CMD_SHIMS.has(lower) && !WINDOWS_PATHEXT_SHIMS.has(lower) && !lower.endsWith(".cmd") && !lower.endsWith(".bat")) {
    return { command, args };
  }
  const shim = lower.endsWith(".cmd") || lower.endsWith(".bat") || WINDOWS_PATHEXT_SHIMS.has(lower) ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", shim, ...args] };
}

export function normalizeExecutableName(commandName: string): string {
  return path.basename(commandName).replace(/\.(cmd|bat|exe)$/i, "").toLowerCase();
}

export function isPathLikeCommand(commandName: string): boolean {
  return path.isAbsolute(commandName) || /[\\/]/.test(commandName);
}

export async function isPackageManagerAvailable(
  packageManager: string,
  platform: NodeJS.Platform,
  commandExists = defaultCommandExists
): Promise<boolean> {
  const candidates = platform === "win32" ? [`${packageManager}.cmd`, `${packageManager}.bat`, packageManager] : [packageManager];
  for (const candidate of candidates) {
    if (await commandExists(candidate, platform)) return true;
  }
  return false;
}

export async function isCommandAvailable(
  command: string,
  platform: NodeJS.Platform,
  commandExists = defaultCommandExists
): Promise<boolean> {
  const candidates = platform === "win32" ? [`${command}.cmd`, `${command}.bat`, command] : [command];
  for (const candidate of candidates) {
    if (await commandExists(candidate, platform)) return true;
  }
  return false;
}

export async function defaultCommandExists(command: string, platform: NodeJS.Platform): Promise<boolean> {
  try {
    if (platform === "win32") {
      await execFileAsync("where.exe", [command], { windowsHide: true });
      return true;
    }
    await execFileAsync("sh", ["-c", `command -v ${shellQuote(command)}`]);
    return true;
  } catch {
    return false;
  }
}

export async function runExecFile(
  command: string,
  args: string[],
  platform: NodeJS.Platform,
  options: CommandResolutionOptions,
  timeoutMs: number
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  if (options.execFile) return options.execFile(command, args, { timeoutMs, env: options.env });
  const invocation = createSpawnInvocation(command, args, platform);
  try {
    const result = await execFileAsync(invocation.command, invocation.args, {
      timeout: timeoutMs,
      windowsHide: true,
      env: options.env ?? process.env
    });
    return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
  } catch (error) {
    const failed = error as { stdout?: string; stderr?: string; code?: number };
    return {
      stdout: failed.stdout ?? "",
      stderr: failed.stderr ?? "",
      exitCode: typeof failed.code === "number" ? failed.code : 1
    };
  }
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export function formatResolvedCommand(command: string, args: string[], platform: NodeJS.Platform): string {
  if (platform === "win32" && command === "cmd.exe" && args.slice(0, 3).join(" ") === "/d /s /c") {
    return args.slice(3).join(" ");
  }
  return [command, ...args].join(" ").trim();
}

export async function hasAnyFile(
  directory: string,
  fileNames: string[],
  fileExistsFn: (filePath: string) => Promise<boolean>
): Promise<boolean> {
  for (const fileName of fileNames) {
    if (await fileExistsFn(path.join(directory, fileName))) return true;
  }
  return false;
}

export async function directoryHasFileEnding(
  directory: string,
  suffix: string,
  fileExistsFn: (filePath: string) => Promise<boolean>
): Promise<boolean> {
  if (fileExistsFn !== fileExists) {
    return (await fileExistsFn(path.join(directory, `project${suffix}`))) || (await fileExistsFn(path.join(directory, `app${suffix}`)));
  }
  try {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && entry.name.endsWith(suffix));
  } catch {
    return false;
  }
}
