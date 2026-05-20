import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import os from "node:os";
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
const WINDOWS_PATHEXT_SHIMS = new Set(["bundle", "composer", "conda", "dotnet", "gradle", "mvn", "php", "pipenv", "poetry", "ruby", "uv"]);
const PACKAGE_MANAGER_COMMANDS = new Set(["npm", "npx", "pnpm", "yarn", "bun"]);
const COREPACK_MANAGERS = new Set(["pnpm", "yarn"]);
const PYTHON_COMMANDS = new Set(["python", "python3", "py"]);
const JAVA_BUILD_COMMANDS = new Set(["mvn", "mvnw", "gradle", "gradlew"]);
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

export interface PythonEnvironmentCandidate {
  id: string;
  label: string;
  value: string;
  source: "manual" | "vscode" | "local" | "conda-file" | "conda-list" | "terminal";
  detail: string;
}

interface CommandResolutionOptions {
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
      const config = await this.store.readConfig();
      const invocation = await resolveSpawnInvocation(command, {
        projectEnvironment: config.projectEnvironments[path.resolve(command.cwd)]
      });
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
          message: summarizeFailedRun(entry.buffer, exitCode, command),
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

export function summarizeFailedRun(buffer: string[], exitCode: number | null, command?: Command): string {
  const raw = stripAnsiControlSequences(buffer.join(""));
  const knownFailure = summarizeKnownFailure(raw, exitCode, command);
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
    /Cannot find package ['"][^'"]+['"]|Cannot find module ['"][^'"]+['"]/i,
    /not recognized as an internal or external command|command not found|spawn .+ ENOENT/i,
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

function summarizeKnownFailure(rawLog: string, exitCode: number | null, command?: Command): string | undefined {
  const pythonMissingModule = rawLog.match(/ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/i);
  if (pythonMissingModule?.[1]) {
    const moduleName = pythonMissingModule[1];
    const packageName = pythonPackageInstallName(moduleName);
    return [
      `缺少 Python 依赖：${moduleName}。`,
      `请在该项目当前 Python 环境中安装：python -m pip install ${packageName}。`,
      "如果项目有 requirements.txt / pyproject.toml，请先同步依赖；如果依赖已经安装过，通常是 Dev Cockpit、终端或 IDE 使用的 Python 环境不一致。",
      "Conda 项目请在项目详情的运行环境中选择检测到的 Conda 候选，或填写 conda:环境名；如果习惯从终端运行，也可以先 conda activate 后再从同一终端启动 npx local-dev-cockpit。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  const nodeMissingPackage = parseNodeMissingPackage(rawLog);
  if (nodeMissingPackage) {
    const installCommand = packageInstallCommand(command);
    const addCommand = packageAddCommand(command, nodeMissingPackage.name);
    return [
      nodeMissingPackage.kind === "dependency"
        ? `缺少 Node 依赖：${nodeMissingPackage.name}。`
        : `Node 无法找到本地文件或模块：${nodeMissingPackage.name}。`,
      nodeMissingPackage.kind === "dependency"
        ? `请先在项目目录运行：${installCommand}；如果依旧缺失，再运行：${addCommand}。`
        : "请检查源码路径、构建产物或 tsconfig/别名配置是否正确。",
      "如果终端能跑但 Dev Cockpit 不能跑，通常是项目依赖未安装到当前工作目录，或使用了不同的包管理器。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  const missingScriptBinary = parseMissingScriptBinary(rawLog);
  if (missingScriptBinary) {
    return [
      `脚本命令缺失：${missingScriptBinary}。`,
      `这通常表示 node_modules 没安装，或 package.json 里的脚本依赖没有同步。请先在项目目录运行：${packageInstallCommand(command)}。`,
      "如果安装后仍失败，请确认该命令是否写在 devDependencies 中。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  if (isPhpComposerAutoloadFailure(rawLog)) {
    return [
      "PHP 依赖尚未安装或未同步：缺少 vendor/autoload.php。",
      "请在项目目录运行：composer install。",
      "如果已经安装过依赖，请确认当前命令的工作目录是包含 composer.json 的项目根目录。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  if (isRubyBundleFailure(rawLog)) {
    return [
      "Ruby 依赖尚未安装或未同步。",
      "请在项目目录运行：bundle install。",
      "如果使用 rbenv、rvm 或 asdf，请确认 Dev Cockpit 启动时继承到了正确的 Ruby 环境。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  if (isDotnetRestoreFailure(rawLog)) {
    return [
      ".NET restore 产物缺失。",
      "请在项目目录运行：dotnet restore，然后再启动项目。",
      "如果项目在私有 NuGet 源中，请先确认本机 NuGet 凭据可用。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  return undefined;
}

function parseNodeMissingPackage(rawLog: string): { name: string; kind: "dependency" | "local-module" } | undefined {
  const match =
    rawLog.match(/Cannot find package ['"]([^'"]+)['"]/i) ??
    rawLog.match(/Cannot find module ['"]([^'"]+)['"]/i) ??
    rawLog.match(/Error \[ERR_MODULE_NOT_FOUND\]:\s*Cannot find package ['"]([^'"]+)['"]/i);
  const name = match?.[1]?.trim();
  if (!name) return undefined;
  const kind = isLocalModuleReference(name) ? "local-module" : "dependency";
  return { name, kind };
}

function parseMissingScriptBinary(rawLog: string): string | undefined {
  const match =
    rawLog.match(/['"]?([A-Za-z0-9._-]+)(?:\.cmd)?['"]?\s+is not recognized as an internal or external command/i) ??
    rawLog.match(/(?:sh:\s*)?([A-Za-z0-9._-]+):\s*command not found/i) ??
    rawLog.match(/spawn\s+([A-Za-z0-9._-]+)\s+ENOENT/i);
  const binary = match?.[1]?.trim();
  if (!binary || ["node", "npm", "pnpm", "yarn", "bun", "python", "python3", "py"].includes(binary.toLowerCase())) return undefined;
  return binary;
}

function isPhpComposerAutoloadFailure(rawLog: string): boolean {
  return /vendor[\\/]+autoload\.php/i.test(rawLog) || /Failed opening required ['"][^'"]*autoload\.php['"]/i.test(rawLog);
}

function isRubyBundleFailure(rawLog: string): boolean {
  return /Could not find gem ['"][^'"]+['"]/i.test(rawLog) || /Run `bundle install` to install missing gems/i.test(rawLog);
}

function isDotnetRestoreFailure(rawLog: string): boolean {
  return /NETSDK1004/i.test(rawLog) || /project\.assets\.json/i.test(rawLog);
}

function packageInstallCommand(command?: Command): string {
  const manager = command ? normalizeExecutableName(command.command) : undefined;
  switch (manager) {
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

function packageAddCommand(command: Command | undefined, packageName: string): string {
  const manager = command ? normalizeExecutableName(command.command) : undefined;
  switch (manager) {
    case "pnpm":
      return `pnpm add ${packageName}`;
    case "yarn":
      return `yarn add ${packageName}`;
    case "bun":
      return `bun add ${packageName}`;
    case "npm":
    default:
      return `npm install ${packageName}`;
  }
}

function isLocalModuleReference(name: string): boolean {
  return name.startsWith(".") || name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(name);
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
  const normalized = normalizeExecutableName(commandName);
  if (PYTHON_COMMANDS.has(lower)) {
    const pythonInvocation = await resolvePythonInvocation(command, lower, platform, options);
    if (pythonInvocation) return pythonInvocation;
  }
  if (!PACKAGE_MANAGER_COMMANDS.has(lower)) {
    const missingRuntime = await missingVerifiedRuntimeMessage(commandName, platform, options.commandExists);
    if (missingRuntime) throw new Error(missingRuntime);
    const missingJava = await missingJavaRuntimeForBuildTool(normalized, platform, options);
    if (missingJava) throw new Error(missingJava);
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
    const preflight = await diagnoseProjectDependencyState(command, options);
    const verification = commandVerificationKind(command.command);
    if (preflight) {
      return {
        commandId: command.id,
        label: command.label,
        status: "warn",
        summary: preflight.summary,
        detail: `${preflight.detail} 解析命令：${formatResolvedCommand(invocation.command, invocation.args, platform)}`,
        resolvedCommand: formatResolvedCommand(invocation.command, invocation.args, platform)
      };
    }
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

export async function validatePythonEnvironmentBinding(
  projectPath: string,
  rawValue: string,
  options: CommandResolutionOptions = {}
): Promise<void> {
  const value = rawValue.trim();
  if (!value) return;
  const platform = options.platform ?? process.platform;
  const condaMatch = value.match(/^conda:(.+)$/i);
  if (condaMatch) {
    const envName = condaMatch[1]?.trim();
    if (!envName) throw new Error("Conda 环境名为空。请填写 conda:环境名。");
    if (!/^[\w.\-]+$/.test(envName)) {
      throw new Error("Conda 环境名包含异常字符。请填写类似 conda:api-env 的格式。");
    }
    if (!(await isCommandAvailable("conda", platform, options.commandExists))) {
      throw new Error(`本机找不到 conda，无法使用 ${value}。`);
    }
    return;
  }

  const expanded = expandConfiguredPath(value, projectPath).trim();
  if (!expanded || !isPathLikeCommand(expanded)) {
    throw new Error("Python 环境请填写 conda:环境名、python.exe 路径或虚拟环境目录。");
  }
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(projectPath, expanded);
  const fileExistsFn = options.fileExists ?? fileExists;
  for (const pythonPath of candidatePythonInterpreterPaths(candidate, platform)) {
    if (await fileExistsFn(pythonPath)) return;
  }
  throw new Error(`找不到可用的 Python 解释器：${value}`);
}

async function discoverCondaEnvironmentCandidates(
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

async function diagnoseProjectDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const normalized = normalizeExecutableName(command.command);
  if (PACKAGE_MANAGER_COMMANDS.has(normalized)) return diagnoseNodeDependencyState(command, options);
  if (PYTHON_COMMANDS.has(normalized)) return diagnosePythonDependencyState(command, options);
  const javaTool = javaBuildToolFromCommand(normalized);
  if (javaTool) return diagnoseJavaDependencyState(command, javaTool, options);
  if (normalized === "php" || normalized === "composer") return diagnosePhpDependencyState(command, options);
  if (normalized === "bundle" || normalized === "ruby") return diagnoseRubyDependencyState(command, options);
  if (normalized === "dotnet") return diagnoseDotnetDependencyState(command, options);
  return undefined;
}

async function diagnoseNodeDependencyState(
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

async function diagnosePythonDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const platform = options.platform ?? process.platform;
  const fileExistsFn = options.fileExists ?? fileExists;
  const hasDependencyManifest = await hasPythonDependencyManifest(command.cwd, fileExistsFn);
  if (!hasDependencyManifest) return undefined;
  if (await resolveConfiguredProjectPythonInvocation(command, normalizeExecutableName(command.command), platform, options)) return undefined;
  if (await findConfiguredPythonInterpreter(command.cwd, platform, options)) return undefined;
  if (await findLocalPythonInterpreter(command.cwd, platform, options.fileExists)) return undefined;
  if (await findDeclaredCondaEnvironment(command.cwd, options)) return undefined;
  if (await findPythonProjectRunner(command.cwd, platform, options)) return undefined;
  if (await resolveInheritedPythonInvocation(command, normalizeExecutableName(command.command), platform, options)) return undefined;

  return {
    summary: "Python 项目依赖环境未固定。",
    detail:
      "检测到 requirements.txt / pyproject.toml，但未找到 .venv、venv、.conda 或 environment.yml。Dev Cockpit 会回退系统 Python；如果启动后缺包，请先创建/激活项目虚拟环境并安装依赖。"
  };
}

async function diagnoseJavaDependencyState(
  command: Command,
  tool: "mvn" | "gradle",
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  const isMavenProject = await fileExistsFn(path.join(command.cwd, "pom.xml"));
  const isGradleProject =
    (await fileExistsFn(path.join(command.cwd, "build.gradle"))) ||
    (await fileExistsFn(path.join(command.cwd, "build.gradle.kts"))) ||
    (await fileExistsFn(path.join(command.cwd, "settings.gradle"))) ||
    (await fileExistsFn(path.join(command.cwd, "settings.gradle.kts")));
  if (tool === "mvn" && !isMavenProject) return undefined;
  if (tool === "gradle" && !isGradleProject) return undefined;

  if (tool === "mvn" && !(await hasAnyFile(command.cwd, ["mvnw", "mvnw.cmd"], fileExistsFn))) {
    return {
      summary: "Java 项目未提交 Maven wrapper。",
      detail: "当前会使用系统 Maven。为了让其他机器更容易运行，建议项目提交 mvnw / mvnw.cmd；否则需要用户本机已安装 Maven。"
    };
  }

  if (tool === "gradle" && !(await hasAnyFile(command.cwd, ["gradlew", "gradlew.bat"], fileExistsFn))) {
    return {
      summary: "Java 项目未提交 Gradle wrapper。",
      detail: "当前会使用系统 Gradle。为了让其他机器更容易运行，建议项目提交 gradlew / gradlew.bat；否则需要用户本机已安装 Gradle。"
    };
  }

  return undefined;
}

async function diagnosePhpDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  const hasComposerJson = await fileExistsFn(path.join(command.cwd, "composer.json"));
  if (!hasComposerJson) return undefined;
  if (await fileExistsFn(path.join(command.cwd, "vendor", "autoload.php"))) return undefined;
  const commandName = normalizeExecutableName(command.command);
  if (commandName !== "php" && commandName !== "composer") return undefined;

  return {
    summary: "PHP 依赖可能尚未安装。",
    detail: "检测到 composer.json，但没有 vendor/autoload.php。首次运行 Laravel 或 Composer 脚本前建议执行：composer install。"
  };
}

async function diagnoseRubyDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  if (!(await fileExistsFn(path.join(command.cwd, "Gemfile")))) return undefined;
  if (await fileExistsFn(path.join(command.cwd, "Gemfile.lock"))) return undefined;
  const commandName = normalizeExecutableName(command.command);
  if (commandName !== "bundle" && commandName !== "ruby") return undefined;

  return {
    summary: "Ruby 依赖锁定文件缺失。",
    detail: "检测到 Gemfile，但没有 Gemfile.lock。首次运行 Rails/Rack 前建议执行：bundle install，并提交 Gemfile.lock 以减少不同机器的依赖差异。"
  };
}

async function diagnoseDotnetDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  const hasDotnetProject =
    (await directoryHasFileEnding(command.cwd, ".csproj", fileExistsFn)) ||
    (await directoryHasFileEnding(command.cwd, ".sln", fileExistsFn));
  if (!hasDotnetProject) return undefined;
  if (await fileExistsFn(path.join(command.cwd, "obj", "project.assets.json"))) return undefined;

  return {
    summary: ".NET restore 产物未发现。",
    detail: "检测到 .NET 项目，但没有 obj/project.assets.json。首次运行前建议执行：dotnet restore；否则运行时可能需要联网恢复 NuGet 包。"
  };
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

async function hasPythonDependencyManifest(
  projectPath: string,
  fileExistsFn: (filePath: string) => Promise<boolean>
): Promise<boolean> {
  for (const base of candidateEnvironmentBases(projectPath)) {
    for (const fileName of ["requirements.txt", "requirements-dev.txt", "pyproject.toml", "Pipfile", "poetry.lock"]) {
      if (await fileExistsFn(path.join(base, fileName))) return true;
    }
  }
  return false;
}

async function hasAnyFile(
  directory: string,
  fileNames: string[],
  fileExistsFn: (filePath: string) => Promise<boolean>
): Promise<boolean> {
  for (const fileName of fileNames) {
    if (await fileExistsFn(path.join(directory, fileName))) return true;
  }
  return false;
}

async function directoryHasFileEnding(
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
  const configuredProjectInvocation = await resolveConfiguredProjectPythonInvocation(command, lowerCommand, platform, options);
  if (configuredProjectInvocation) return configuredProjectInvocation;

  const configuredInterpreter = await findConfiguredPythonInterpreter(command.cwd, platform, options);
  if (configuredInterpreter) {
    return {
      ...createSpawnInvocation(configuredInterpreter.path, command.args, platform),
      note: `已使用编辑器配置的 Python 环境：${configuredInterpreter.label}。`
    };
  }

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

  const projectRunner = await findPythonProjectRunner(command.cwd, platform, options);
  if (projectRunner) {
    const pythonCommand = lowerCommand === "py" ? "python" : command.command;
    return {
      ...createSpawnInvocation(projectRunner.command, [...projectRunner.argsPrefix, pythonCommand, ...command.args], platform),
      note: `已通过 ${projectRunner.label} 运行 Python 命令；来源：${projectRunner.filePath}。`
    };
  }

  const inheritedInvocation = await resolveInheritedPythonInvocation(command, lowerCommand, platform, options);
  if (inheritedInvocation) return inheritedInvocation;

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

async function missingJavaRuntimeForBuildTool(
  normalizedCommand: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<string | undefined> {
  if (!JAVA_BUILD_COMMANDS.has(normalizedCommand)) return undefined;
  if (await isJavaRuntimeAvailable(platform, options)) return undefined;
  return "Java/JDK 不可用。Maven/Gradle 项目需要 Java。请安装 JDK，并配置 JAVA_HOME 或把 java 加入 PATH。";
}

async function isJavaRuntimeAvailable(platform: NodeJS.Platform, options: CommandResolutionOptions): Promise<boolean> {
  if (await isCommandAvailable("java", platform, options.commandExists)) return true;

  const env = options.env ?? process.env;
  const javaHome = env.JAVA_HOME?.trim();
  if (!javaHome) return false;

  const javaExecutable = platform === "win32" ? "java.exe" : "java";
  const fileExistsFn = options.fileExists ?? fileExists;
  return fileExistsFn(path.join(javaHome, "bin", javaExecutable));
}

function javaBuildToolFromCommand(normalizedCommand: string): "mvn" | "gradle" | undefined {
  if (normalizedCommand === "mvn" || normalizedCommand === "mvnw") return "mvn";
  if (normalizedCommand === "gradle" || normalizedCommand === "gradlew") return "gradle";
  return undefined;
}

async function findLocalPythonInterpreter(
  projectPath: string,
  platform: NodeJS.Platform,
  fileExistsOverride?: (filePath: string) => Promise<boolean>
): Promise<{ path: string; label: string } | undefined> {
  return (await findLocalPythonInterpreters(projectPath, platform, fileExistsOverride))[0];
}

async function findLocalPythonInterpreters(
  projectPath: string,
  platform: NodeJS.Platform,
  fileExistsOverride?: (filePath: string) => Promise<boolean>
): Promise<Array<{ path: string; label: string }>> {
  const fileExistsFn = fileExistsOverride ?? fileExists;
  const bases = candidateEnvironmentBases(projectPath);
  const envNames = [".venv", "venv", ".env", "env", ".conda", "conda"];
  const relativeInterpreters =
    platform === "win32"
      ? ["Scripts/python.exe", "python.exe"]
      : ["bin/python", "python"];
  const interpreters: Array<{ path: string; label: string }> = [];

  for (const base of bases) {
    for (const envName of envNames) {
      for (const relativeInterpreter of relativeInterpreters) {
        const interpreterPath = path.join(base, envName, relativeInterpreter);
        if (await fileExistsFn(interpreterPath)) {
          interpreters.push({ path: interpreterPath, label: describeEnvironmentPath(projectPath, interpreterPath) });
          break;
        }
      }
    }
  }
  return interpreters;
}

async function findConfiguredPythonInterpreter(
  projectPath: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<{ path: string; label: string } | undefined> {
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

async function resolveConfiguredProjectPythonInvocation(
  command: Command,
  lowerCommand: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<SpawnInvocation | undefined> {
  const rawValue = options.projectEnvironment?.python?.trim();
  if (!rawValue) return undefined;
  const condaMatch = rawValue.match(/^conda:(.+)$/i);
  if (condaMatch) {
    const envName = condaMatch[1]?.trim();
    if (!envName) throw new Error("项目绑定的 Conda 环境名为空。");
    if (!(await isCommandAvailable("conda", platform, options.commandExists))) {
      throw new Error(`项目绑定了 Conda 环境 ${envName}，但本机找不到 conda。`);
    }
    const pythonCommand = lowerCommand === "py" ? "python" : command.command;
    return {
      ...createSpawnInvocation("conda", ["run", "-n", envName, pythonCommand, ...command.args], platform),
      note: `已使用项目绑定的 Conda 环境：${envName}。`
    };
  }

  const fileExistsFn = options.fileExists ?? fileExists;
  const expanded = expandConfiguredPath(rawValue, command.cwd).trim();
  if (!expanded) return undefined;
  const candidate = path.isAbsolute(expanded) ? expanded : path.resolve(command.cwd, expanded);
  for (const pythonPath of candidatePythonInterpreterPaths(candidate, platform)) {
    if (await fileExistsFn(pythonPath)) {
      return {
        ...createSpawnInvocation(pythonPath, command.args, platform),
        note: `已使用项目绑定的 Python 环境：${pythonPath}。`
      };
    }
  }
  throw new Error(`项目绑定的 Python 环境不存在：${rawValue}`);
}

async function resolveInheritedPythonInvocation(
  command: Command,
  lowerCommand: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<SpawnInvocation | undefined> {
  const env = options.env ?? process.env;
  const fileExistsFn = options.fileExists ?? fileExists;
  const activeEnvPath = env.VIRTUAL_ENV || env.CONDA_PREFIX;
  if (activeEnvPath) {
    const label = env.CONDA_PREFIX ? "当前终端 Conda 环境" : "当前终端虚拟环境";
    for (const pythonPath of candidatePythonInterpreterPaths(activeEnvPath, platform)) {
      if (await fileExistsFn(pythonPath)) {
        return {
          ...createSpawnInvocation(pythonPath, command.args, platform),
          note: `已使用${label}：${pythonPath}。`
        };
      }
    }
  }

  const condaName = env.CONDA_DEFAULT_ENV?.trim();
  if (condaName && condaName.toLowerCase() !== "base" && (await isCommandAvailable("conda", platform, options.commandExists))) {
    const pythonCommand = lowerCommand === "py" ? "python" : command.command;
    return {
      ...createSpawnInvocation("conda", ["run", "-n", condaName, pythonCommand, ...command.args], platform),
      note: `已通过当前终端 Conda 环境 ${condaName} 运行。`
    };
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

async function findPythonProjectRunner(
  projectPath: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<{ command: "uv" | "poetry" | "pipenv"; argsPrefix: string[]; label: string; filePath: string } | undefined> {
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

function candidatePythonInterpreterPaths(candidate: string, platform: NodeJS.Platform): string[] {
  const names = platform === "win32" ? ["Scripts/python.exe", "python.exe"] : ["bin/python", "python"];
  const basename = path.basename(candidate).toLowerCase();
  const candidateLooksExecutable =
    basename === "python" ||
    basename === "python.exe" ||
    basename === "python3" ||
    /^python\d+(\.\d+)?(\.exe)?$/.test(basename);
  return candidateLooksExecutable ? [candidate] : names.map((name) => path.join(candidate, name));
}

function expandConfiguredPath(rawValue: string, workspacePath: string): string {
  let value = rawValue.trim().replace(/^['"]|['"]$/g, "");
  value = value.replace(/\$\{workspaceFolder(?::[^}]+)?\}|\$\{workspaceRoot\}/g, workspacePath);
  value = value.replace(/\$\{env:([^}]+)\}/g, (_match, name: string) => process.env[name] ?? "");
  value = value.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? "");
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    value = path.join(os.homedir(), value.slice(2));
  }
  return value;
}

function parseCondaEnvironmentName(raw: string): string | undefined {
  const match = raw.match(/^\s*name\s*:\s*([^\r\n#]+)/m);
  const name = match?.[1]?.trim().replace(/^['"]|['"]$/g, "");
  if (!name || name.toLowerCase() === "base") return undefined;
  return name;
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

async function runExecFile(
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
