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

const WINDOWS_CMD_SHIMS = new Set(["npm", "npx", "pnpm", "yarn", "bun", "corepack"]);
const WINDOWS_PATHEXT_SHIMS = new Set(["bundle", "composer", "conda", "dotnet", "gradle", "mvn", "php", "ruby"]);
const PACKAGE_MANAGER_COMMANDS = new Set(["npm", "npx", "pnpm", "yarn", "bun"]);
const COREPACK_MANAGERS = new Set(["pnpm", "yarn"]);
const PYTHON_COMMANDS = new Set(["python", "python3", "py"]);
const VERIFIED_RUNTIME_COMMANDS = new Set(["bundle", "composer", "docker", "dotnet", "go", "gradle", "mvn", "php", "ruby", "cargo"]);
const execFileAsync = promisify(execFile);

interface SpawnInvocation {
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

interface CommandResolutionOptions {
  platform?: NodeJS.Platform;
  commandExists?: (command: string, platform: NodeJS.Platform) => Promise<boolean>;
  fileExists?: (filePath: string) => Promise<boolean>;
  readFile?: (filePath: string) => Promise<string>;
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
  const raw = stripAnsiControlSequences(buffer.join(""));
  const knownFailure = summarizeKnownFailure(raw, exitCode);
  if (knownFailure) return knownFailure;

  const lines = raw
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
    /ModuleNotFoundError:\s*No module named/i,
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

function summarizeKnownFailure(rawLog: string, exitCode: number | null): string | undefined {
  const pythonMissingModule = rawLog.match(/ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/i);
  if (pythonMissingModule?.[1]) {
    const moduleName = pythonMissingModule[1];
    const packageName = pythonPackageInstallName(moduleName);
    return [
      `缺少 Python 依赖：${moduleName}。`,
      `请在该项目当前 Python 环境中安装：python -m pip install ${packageName}。`,
      "如果项目有 requirements.txt / pyproject.toml，请先同步依赖；如果已经安装过，通常是 Dev Cockpit、终端或 IDE 使用的 Python 环境不一致。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  return undefined;
}

function pythonPackageInstallName(moduleName: string): string {
  const rootModule = moduleName.split(".")[0]?.trim() ?? moduleName;
  const knownMappings: Record<string, string> = {
    PIL: "Pillow",
    cv2: "opencv-python",
    dotenv: "python-dotenv",
    jwt: "PyJWT",
    sklearn: "scikit-learn",
    yaml: "PyYAML"
  };
  return knownMappings[rootModule] ?? rootModule;
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
  if (PYTHON_COMMANDS.has(lower)) {
    const pythonInvocation = await resolvePythonInvocation(command, lower, platform, options);
    if (pythonInvocation) return pythonInvocation;
  }
  if (!PACKAGE_MANAGER_COMMANDS.has(lower)) {
    const missingRuntime = await missingVerifiedRuntimeMessage(commandName, platform, options.commandExists);
    if (missingRuntime) throw new Error(missingRuntime);
    return createSpawnInvocation(commandName, command.args, platform);
  }

  if (await isPackageManagerAvailable(lower, platform, options.commandExists)) {
    return createSpawnInvocation(commandName, command.args, platform);
  }

  const fallback = await resolvePackageManagerFallback(command, lower, platform, options);
  if (fallback) return fallback;

  throw new Error(packageManagerMissingMessage(lower));
}

export async function diagnoseCommandEnvironment(
  command: Command,
  options: CommandResolutionOptions = {}
): Promise<CommandEnvironmentDiagnostic> {
  try {
    const platform = options.platform ?? process.platform;
    const invocation = await resolveSpawnInvocation(command, options);
    const verification = commandVerificationKind(command.command);
    return {
      commandId: command.id,
      label: command.label,
      status: verification === "unverified" ? "warn" : "ready",
      summary:
        invocation.note ??
        (verification === "unverified" ? "命令未自动验证，请确认它在 PATH 中可用。" : "运行环境已识别。"),
      detail: formatResolvedCommand(invocation.command, invocation.args, platform),
      resolvedCommand: formatResolvedCommand(invocation.command, invocation.args, platform)
    };
  } catch (error) {
    return {
      commandId: command.id,
      label: command.label,
      status: "missing",
      summary: "运行环境缺失。",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function commandVerificationKind(commandName: string): "verified" | "unverified" {
  const normalized = normalizeExecutableName(commandName);
  if (isPathLikeCommand(commandName)) return "verified";
  if (PYTHON_COMMANDS.has(normalized) || PACKAGE_MANAGER_COMMANDS.has(normalized) || VERIFIED_RUNTIME_COMMANDS.has(normalized)) return "verified";
  return "unverified";
}

async function resolvePythonInvocation(
  command: Command,
  lowerCommand: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<SpawnInvocation | undefined> {
  const localInterpreter = await findLocalPythonInterpreter(command.cwd, platform, options.fileExists);
  if (localInterpreter) {
    return {
      ...createSpawnInvocation(localInterpreter.path, command.args, platform),
      note: `已使用项目 Python 环境：${localInterpreter.label}。`
    };
  }

  const condaEnvironment = await findDeclaredCondaEnvironment(command.cwd, options);
  if (condaEnvironment && (await isCommandAvailable("conda", platform, options.commandExists))) {
    const pythonCommand = lowerCommand === "py" ? "python" : command.command;
    return {
      ...createSpawnInvocation("conda", ["run", "-n", condaEnvironment.name, pythonCommand, ...command.args], platform),
      note: `已通过 Conda 环境 ${condaEnvironment.name} 运行；来源：${condaEnvironment.filePath}。`
    };
  }

  if (await isCommandAvailable(command.command, platform, options.commandExists)) return undefined;
  if (platform === "win32" && lowerCommand !== "py" && (await isCommandAvailable("py", platform, options.commandExists))) {
    return {
      ...createSpawnInvocation("py", command.args, platform),
      note: "未找到项目虚拟环境，已使用 Windows Python Launcher。"
    };
  }

  throw new Error("未找到可用的 Python。请在项目中创建 .venv/venv/.conda，或安装 Python/Conda 后再运行。");
}

async function missingVerifiedRuntimeMessage(
  commandName: string,
  platform: NodeJS.Platform,
  commandExists = defaultCommandExists
): Promise<string | undefined> {
  if (isPathLikeCommand(commandName)) return undefined;
  const normalized = normalizeExecutableName(commandName);
  if (!VERIFIED_RUNTIME_COMMANDS.has(normalized)) return undefined;
  if (await isCommandAvailable(normalized, platform, commandExists)) return undefined;
  return runtimeMissingMessage(normalized);
}

async function findLocalPythonInterpreter(
  projectPath: string,
  platform: NodeJS.Platform,
  fileExistsOverride?: (filePath: string) => Promise<boolean>
): Promise<{ path: string; label: string } | undefined> {
  const fileExistsFn = fileExistsOverride ?? fileExists;
  const bases = candidateEnvironmentBases(projectPath);
  const envNames = [".venv", "venv", ".env", "env", ".conda", "conda"];
  const relativeInterpreters =
    platform === "win32"
      ? ["Scripts/python.exe", "python.exe"]
      : ["bin/python", "python"];

  for (const base of bases) {
    for (const envName of envNames) {
      for (const relativeInterpreter of relativeInterpreters) {
        const interpreterPath = path.join(base, envName, relativeInterpreter);
        if (await fileExistsFn(interpreterPath)) {
          return { path: interpreterPath, label: describeEnvironmentPath(projectPath, interpreterPath) };
        }
      }
    }
  }
  return undefined;
}

async function findDeclaredCondaEnvironment(
  projectPath: string,
  options: CommandResolutionOptions
): Promise<{ name: string; filePath: string } | undefined> {
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

function parseCondaEnvironmentName(raw: string): string | undefined {
  const match = raw.match(/^\s*name\s*:\s*([^\r\n#]+)/m);
  const name = match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  if (!name || name.toLowerCase() === "base") return undefined;
  return name;
}

function candidateEnvironmentBases(projectPath: string): string[] {
  const resolved = path.resolve(projectPath);
  const parent = path.dirname(resolved);
  return parent && parent !== resolved ? [resolved, parent] : [resolved];
}

function describeEnvironmentPath(projectPath: string, interpreterPath: string): string {
  const relative = path.relative(projectPath, interpreterPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : interpreterPath;
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
  if (!WINDOWS_CMD_SHIMS.has(lower) && !WINDOWS_PATHEXT_SHIMS.has(lower) && !lower.endsWith(".cmd") && !lower.endsWith(".bat")) {
    return { command, args };
  }
  const shim = lower.endsWith(".cmd") || lower.endsWith(".bat") || WINDOWS_PATHEXT_SHIMS.has(lower) ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", shim, ...args] };
}

function normalizeExecutableName(commandName: string): string {
  return path.basename(commandName).replace(/\.(cmd|bat|exe)$/i, "").toLowerCase();
}

function isPathLikeCommand(commandName: string): boolean {
  return path.isAbsolute(commandName) || /[\\/]/.test(commandName);
}

async function isPackageManagerAvailable(
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

async function isCommandAvailable(
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

async function readTextFile(filePath: string): Promise<string> {
  return fs.readFile(filePath, "utf8");
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

function runtimeMissingMessage(commandName: string): string {
  const hints: Record<string, string> = {
    bundle: "Ruby 项目通常需要先安装 Ruby、Bundler，并在项目中执行 bundle install。",
    composer: "PHP 项目通常需要先安装 PHP、Composer，并在项目中执行 composer install。",
    docker: "Docker 命令不可用。请确认 Docker Desktop 已安装并启动。",
    dotnet: ".NET SDK 不可用。请安装 .NET SDK 后再运行。",
    go: "Go 命令不可用。请安装 Go 并加入 PATH。",
    gradle: "Gradle 不可用。建议优先提交 gradlew/gradlew.bat wrapper，或安装 Gradle。",
    mvn: "Maven 不可用。建议优先提交 mvnw/mvnw.cmd wrapper，或安装 Maven。",
    php: "PHP 命令不可用。请安装 PHP 并加入 PATH。",
    ruby: "Ruby 命令不可用。请安装 Ruby 并加入 PATH。",
    cargo: "Cargo 不可用。请安装 Rust 工具链。"
  };
  return `${commandName} 未安装或不在 PATH 中。${hints[commandName] ?? "请安装对应运行时后再运行。"}`;
}

function formatResolvedCommand(command: string, args: string[], platform: NodeJS.Platform): string {
  if (platform === "win32" && command === "cmd.exe" && args.slice(0, 3).join(" ") === "/d /s /c") {
    return args.slice(3).join(" ");
  }
  return [command, ...args].join(" ").trim();
}
