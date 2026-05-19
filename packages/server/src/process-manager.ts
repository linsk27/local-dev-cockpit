import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import type { Command, ErrorSummary, ProcessRun } from "@local-dev-cockpit/core";
import type { AppPaths } from "./paths.js";
import type { JsonStore } from "./store.js";
import type { EventBus } from "./events.js";
import { decodeProcessChunk, stripAnsiControlSequences } from "./log-decoder.js";

interface RunningProcess {
  run: ProcessRun;
  child: ChildProcessWithoutNullStreams;
  buffer: string[];
}

const WINDOWS_COMMAND_SHIMS = new Set(["npm", "npx", "pnpm", "yarn", "bun", "corepack"]);
const PACKAGE_MANAGER_COMMANDS = new Set(["npm", "npx", "pnpm", "yarn", "bun"]);
const COREPACK_MANAGERS = new Set(["pnpm", "yarn"]);
const execFileAsync = promisify(execFile);

interface SpawnInvocation {
  command: string;
  args: string[];
  note?: string;
}

interface CommandResolutionOptions {
  platform?: NodeJS.Platform;
  commandExists?: (command: string, platform: NodeJS.Platform) => Promise<boolean>;
  fileExists?: (filePath: string) => Promise<boolean>;
}

/**
 * Owns child-process lifecycle. It intentionally accepts structured commands
 * only, so callers cannot smuggle shell-composed strings into execution.
 */
export class ProcessManager {
  private readonly running = new Map<string, RunningProcess>();

  constructor(
    private readonly paths: AppPaths,
    private readonly store: JsonStore,
    private readonly events: EventBus
  ) {}

  async start(projectId: string, command: Command): Promise<ProcessRun> {
    await fs.mkdir(this.paths.logsDir, { recursive: true });
    const runId = `${projectId}-${Date.now()}`;
    const logPath = path.join(this.paths.logsDir, `${runId}.log`);
    const logStream = createWriteStream(logPath, { flags: "a", encoding: "utf8" });
    const run: ProcessRun = {
      id: runId,
      projectId,
      commandId: command.id,
      status: "running",
      startedAt: new Date().toISOString(),
      logPath
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      const invocation = await resolveSpawnInvocation(command);
      if (invocation.note) {
        logStream.write(`[dev-cockpit] ${invocation.note}\n`);
      }
      child = spawn(invocation.command, invocation.args, {
        cwd: command.cwd,
        windowsHide: true,
        shell: false,
        env: process.env
      });
    } catch (error) {
      const message = `Failed to start command: ${error instanceof Error ? error.message : String(error)}`;
      const occurredAt = new Date().toISOString();
      run.status = "failed";
      run.exitCode = 1;
      run.exitedAt = occurredAt;
      logStream.write(`[dev-cockpit] ${message}\n`);
      logStream.end();
      await this.store.recordRun(run);
      await this.store.recordError(projectId, { message, commandId: command.id, occurredAt });
      this.events.emit("process.closed", { run });
      return run;
    }

    const entry: RunningProcess = { run, child, buffer: [] };
    this.running.set(runId, entry);
    await this.store.recordRun(run);
    this.events.emit("process.started", { run, command });

    const append = (chunk: Buffer) => {
      const text = decodeProcessChunk(chunk);
      logStream.write(text);
      entry.buffer.push(text);
      if (entry.buffer.length > 400) entry.buffer.splice(0, entry.buffer.length - 400);
      this.events.emit("process.log", { runId, projectId, text });
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let finished = false;
    child.once("error", async (error) => {
      if (finished) return;
      finished = true;
      const occurredAt = new Date().toISOString();
      const message = `Failed to start command: ${error.message}`;
      append(Buffer.from(`[dev-cockpit] ${message}\n`, "utf8"));
      run.status = "failed";
      run.exitCode = 1;
      run.exitedAt = occurredAt;
      logStream.end();
      const summary: ErrorSummary = { message, commandId: command.id, occurredAt };
      await this.store.recordRun(run);
      await this.store.recordError(projectId, summary);
      this.running.delete(runId);
      this.events.emit("process.error", { runId, projectId, error: summary });
      this.events.emit("process.closed", { run });
    });
    child.once("close", async (exitCode) => {
      if (finished) return;
      finished = true;
      run.status = run.status === "stopped" ? "stopped" : exitCode === 0 ? "exited" : "failed";
      run.exitCode = exitCode ?? undefined;
      run.exitedAt = new Date().toISOString();
      logStream.end();
      await this.store.recordRun(run);
      if (run.status === "failed") {
        await this.store.recordError(projectId, {
          message: summarizeFailedRun(entry.buffer, exitCode),
          commandId: command.id,
          occurredAt: run.exitedAt
        });
      }
      this.running.delete(runId);
      this.events.emit("process.closed", { run });
    });

    return run;
  }

  async stop(processId: string): Promise<ProcessRun | undefined> {
    const entry = this.running.get(processId);
    if (!entry) return undefined;
    entry.run.status = "stopped";
    entry.run.exitedAt = new Date().toISOString();
    await killProcessTree(entry.child);
    this.running.delete(processId);
    await this.store.recordRun(entry.run);
    this.events.emit("process.stopped", { run: entry.run });
    return entry.run;
  }

  isRunning(processId: string): boolean {
    return this.running.has(processId);
  }

  async readLogs(runId: string): Promise<string> {
    const live = this.running.get(runId);
    if (live) return stripAnsiControlSequences(live.buffer.join(""));
    const logPath = path.join(this.paths.logsDir, `${runId}.log`);
    try {
      return stripAnsiControlSequences(await fs.readFile(logPath, "utf8"));
    } catch {
      return "";
    }
  }
}

export function summarizeFailedRun(buffer: string[], exitCode: number | null): string {
  const lines = stripAnsiControlSequences(buffer.join(""))
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  const priorityIndex = findFailureLine(lines);
  const window = priorityIndex >= 0 ? lines.slice(priorityIndex, priorityIndex + 8) : lines.slice(-4);
  const taskkillIndex = window.findIndex((line) => /taskkill/i.test(line));
  const selected = taskkillIndex >= 0 ? window.slice(0, taskkillIndex + 1) : window.slice(0, 4);
  const detail = selected.join(" ");
  return detail ? `${detail} (exit code ${exitCode ?? "unknown"})` : `Command exited with code ${exitCode}`;
}

function findFailureLine(lines: string[]): number {
  const priorityPatterns = [
    /another .+server.+already running/i,
    /address already in use|eaddrinuse/i,
    /permission denied/i,
    /cannot find module|module not found/i,
    /port \d+ is in use/i
  ];
  for (const pattern of priorityPatterns) {
    const index = lines.findIndex((line) => pattern.test(line));
    if (index >= 0) return index;
  }
  return -1;
}

async function killProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore"
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }

  child.kill();
}

export async function resolveSpawnInvocation(command: Command, options: CommandResolutionOptions = {}): Promise<SpawnInvocation> {
  const platform = options.platform ?? process.platform;
  const commandName = command.command.trim();
  const lower = commandName.toLowerCase();
  if (!PACKAGE_MANAGER_COMMANDS.has(lower)) {
    return createSpawnInvocation(commandName, command.args, platform);
  }

  if (await isPackageManagerAvailable(lower, platform, options.commandExists)) {
    return createSpawnInvocation(commandName, command.args, platform);
  }

  const fallback = await resolvePackageManagerFallback(command, lower, platform, options);
  if (fallback) return fallback;

  throw new Error(packageManagerMissingMessage(lower));
}

async function resolvePackageManagerFallback(
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

function createSpawnInvocation(command: string, args: string[], platform: NodeJS.Platform): SpawnInvocation {
  if (platform !== "win32") return { command, args };
  const lower = command.toLowerCase();
  if (!WINDOWS_COMMAND_SHIMS.has(lower) && !lower.endsWith(".cmd") && !lower.endsWith(".bat")) {
    return { command, args };
  }
  const shim = lower.endsWith(".cmd") || lower.endsWith(".bat") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", shim, ...args] };
}

async function isPackageManagerAvailable(
  packageManager: string,
  platform: NodeJS.Platform,
  commandExists = defaultCommandExists
): Promise<boolean> {
  const candidates = platform === "win32" ? [`${packageManager}.cmd`, packageManager] : [packageManager];
  for (const candidate of candidates) {
    if (await commandExists(candidate, platform)) return true;
  }
  return false;
}

async function isCommandAvailable(
  command: string,
  platform: NodeJS.Platform,
  commandExists = defaultCommandExists
): Promise<boolean> {
  const candidates = platform === "win32" ? [`${command}.cmd`, command] : [command];
  for (const candidate of candidates) {
    if (await commandExists(candidate, platform)) return true;
  }
  return false;
}

async function defaultCommandExists(command: string, platform: NodeJS.Platform): Promise<boolean> {
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

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

function packageManagerMissingMessage(packageManager: string): string {
  const installHint =
    packageManager === "yarn"
      ? "请安装 Yarn，或启用 corepack，或保留 package-lock.json 后改用 npm。"
      : packageManager === "pnpm"
        ? "请安装 pnpm，或启用 corepack。"
        : packageManager === "bun"
          ? "请安装 Bun，或改用 npm/pnpm/yarn 脚本。"
          : `请确认 ${packageManager} 已加入 PATH。`;
  return `${packageManager} 未安装或不在 PATH 中。${installHint}`;
}
