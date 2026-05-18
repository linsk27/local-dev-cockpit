import path from "node:path";
import type { FileSystemAdapter, ProcessAdapter } from "./adapters.js";
import { NodeFileSystemAdapter, NodeProcessAdapter } from "./node-adapters.js";
import type { Command, GitInfo, PortStatus, Project, ProjectKind, ScanOptions, ScanResult } from "./types.js";

const DEFAULT_IGNORE_NAMES = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".venv",
  "venv",
  "target",
  ".next",
  ".cache",
  "coverage",
  "library",
  "packagecache",
  "temp",
  "obj",
  "logs",
  "usersettings"
]);

const CHILD_PROJECT_DIRECTORY_HINTS = new Set(["frontend", "front", "backend", "api", "server", "client", "web", "apps", "packages", "services"]);

const COMMON_PORTS_BY_KIND: Record<ProjectKind, number[]> = {
  node: [3000, 5173, 4173, 8080],
  python: [5000, 8000, 8080],
  go: [8080, 3000],
  rust: [8000, 8080],
  docker: [80, 3000, 5000, 8000, 8080],
  mixed: [3000, 5000, 5173, 8000, 8080],
  unknown: []
};

export interface ScannerAdapters {
  fs?: FileSystemAdapter;
  process?: ProcessAdapter;
}

export async function scanRoot(
  root: string,
  options: ScanOptions = {},
  adapters: ScannerAdapters = {}
): Promise<ScanResult> {
  const fs = adapters.fs ?? new NodeFileSystemAdapter();
  const processAdapter = adapters.process ?? new NodeProcessAdapter();
  const resolvedRoot = path.resolve(root);
  const maxDepth = options.maxDepth ?? 5;
  const maxProjects = options.maxProjects ?? 80;
  const ignoreNames = new Set([...DEFAULT_IGNORE_NAMES, ...(options.ignoreNames ?? []).map((name) => name.toLowerCase())]);
  const startedAt = Date.now();
  const timeoutMs = options.timeoutMs ?? 15000;
  const projectCandidates: Array<{ path: string; reason: "marker" | "git-root" }> = [];
  const warnings: string[] = [];

  async function walk(dir: string, depth: number): Promise<void> {
    if (Date.now() - startedAt > timeoutMs) {
      warnings.push(`扫描超时，已停止在 ${dir}`);
      return;
    }
    if (depth > maxDepth || projectCandidates.length >= maxProjects) {
      return;
    }

    let entries: Awaited<ReturnType<FileSystemAdapter["readdir"]>>;
    try {
      entries = await fs.readdir(dir);
    } catch (error) {
      warnings.push(`无法读取目录 ${dir}: ${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    const hasGitDirectory = entries.some((entry) => entry.name === ".git" && entry.isDirectory);
    const hasMarker = hasProjectMarker(entries);
    if (hasMarker) {
      projectCandidates.push({ path: dir, reason: "marker" });
      if (!shouldDescendIntoMarkedDirectory(entries)) return;
    }
    if (hasGitDirectory) {
      projectCandidates.push({ path: dir, reason: "git-root" });
    }

    for (const entry of entries) {
      if (!entry.isDirectory || shouldIgnoreDirectory(entry.name, ignoreNames)) {
        continue;
      }
      await walk(path.join(dir, entry.name), depth + 1);
    }
  }

  await walk(resolvedRoot, 0);
  const projects: Project[] = [];

  for (const candidate of projectCandidates) {
    try {
      const project = await analyzeProject(candidate.path, { fs, process: processAdapter });
      if (shouldKeepScannedProject(project, candidate.reason)) {
        projects.push(project);
      }
    } catch (error) {
      warnings.push(`无法分析项目 ${candidate.path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return {
    root: resolvedRoot,
    projects: projects.sort((left, right) => left.name.localeCompare(right.name)),
    warnings,
    scannedAt: new Date().toISOString()
  };
}

function shouldIgnoreDirectory(name: string, ignoreNames: Set<string>): boolean {
  const normalized = name.toLowerCase();
  return ignoreNames.has(normalized) || /^com\.unity\..+@\d/i.test(name);
}

function hasProjectMarker(entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>): boolean {
  const names = new Set(entries.filter((entry) => entry.isFile).map((entry) => entry.name));
  return [
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "go.mod",
    "Cargo.toml",
    "docker-compose.yml",
    "compose.yml",
    "Dockerfile"
  ].some((marker) => names.has(marker));
}

function shouldDescendIntoMarkedDirectory(entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>): boolean {
  const fileNames = new Set(entries.filter((entry) => entry.isFile).map((entry) => entry.name));
  const directoryNames = new Set(entries.filter((entry) => entry.isDirectory).map((entry) => entry.name.toLowerCase()));
  const hasContainerMarker = ["docker-compose.yml", "compose.yml", "Dockerfile"].some((marker) => fileNames.has(marker));
  if (!hasContainerMarker) return false;
  return [...CHILD_PROJECT_DIRECTORY_HINTS].some((name) => directoryNames.has(name));
}

function shouldKeepScannedProject(project: Project, reason: "marker" | "git-root"): boolean {
  if (reason === "git-root") return true;
  if (project.commands.length > 0) return true;
  return project.markers.some((marker) => marker !== "package.json");
}

export async function analyzeProject(projectPath: string, adapters: Required<ScannerAdapters>): Promise<Project> {
  const markers = await detectMarkers(projectPath, adapters.fs);
  const kind = resolveProjectKind(markers);
  const packageManager = await detectPackageManager(projectPath, adapters.fs);
  const commands = await detectCommands(projectPath, markers, packageManager, adapters.fs);
  const git = await readGitInfo(projectPath, adapters.process);
  const ports = await detectPorts(commands, kind, adapters.process);

  return {
    id: encodeProjectId(projectPath),
    name: path.basename(projectPath),
    path: projectPath,
    kind,
    packageManager,
    git,
    commands,
    ports,
    markers
  };
}

export function encodeProjectId(projectPath: string): string {
  return Buffer.from(path.resolve(projectPath), "utf8").toString("base64url");
}

export function decodeProjectId(id: string): string {
  return Buffer.from(id, "base64url").toString("utf8");
}

async function detectMarkers(projectPath: string, fs: FileSystemAdapter): Promise<string[]> {
  const candidates = [
    "package.json",
    "requirements.txt",
    "pyproject.toml",
    "manage.py",
    "run.py",
    "app.py",
    "main.py",
    "app/main.py",
    "go.mod",
    "Cargo.toml",
    "docker-compose.yml",
    "compose.yml",
    "Dockerfile"
  ];
  const found: string[] = [];
  for (const candidate of candidates) {
    if (await fs.exists(path.join(projectPath, candidate))) {
      found.push(candidate);
    }
  }
  return found;
}

function resolveProjectKind(markers: string[]): ProjectKind {
  const kinds = new Set<ProjectKind>();
  if (markers.includes("package.json")) kinds.add("node");
  if (markers.some((marker) => ["requirements.txt", "pyproject.toml", "manage.py", "run.py", "app.py", "main.py", "app/main.py"].includes(marker))) {
    kinds.add("python");
  }
  if (markers.includes("go.mod")) kinds.add("go");
  if (markers.includes("Cargo.toml")) kinds.add("rust");
  if (markers.some((marker) => ["docker-compose.yml", "compose.yml", "Dockerfile"].includes(marker))) kinds.add("docker");
  if (kinds.size === 0) return "unknown";
  if (kinds.size === 1) return [...kinds][0] ?? "unknown";
  return "mixed";
}

async function detectPackageManager(projectPath: string, fs: FileSystemAdapter): Promise<Project["packageManager"]> {
  if (await fs.exists(path.join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (await fs.exists(path.join(projectPath, "yarn.lock"))) return "yarn";
  if (await fs.exists(path.join(projectPath, "bun.lockb"))) return "bun";
  if (await fs.exists(path.join(projectPath, "package-lock.json"))) return "npm";
  if (await fs.exists(path.join(projectPath, "package.json"))) return "npm";
  return undefined;
}

async function detectCommands(
  projectPath: string,
  markers: string[],
  packageManager: Project["packageManager"],
  fs: FileSystemAdapter
): Promise<Command[]> {
  const commands: Command[] = [];

  if (markers.includes("package.json")) {
    commands.push(...(await readPackageScripts(projectPath, packageManager ?? "npm", fs)));
  }

  if (markers.includes("manage.py")) {
    commands.push(command("python-django", "Django dev server", "python", ["manage.py", "runserver"], projectPath, "detected", "dev"));
  }
  const fastApiEntrypoint = await detectFastApiEntrypoint(projectPath, markers, fs);
  if (fastApiEntrypoint) {
    commands.push(
      command(
        `python-fastapi-${fastApiEntrypoint.module.replace(/\W/g, "-")}`,
        `Uvicorn ${fastApiEntrypoint.module}`,
        "python",
        ["-m", "uvicorn", `${fastApiEntrypoint.module}:app`, "--host", "127.0.0.1", "--port", "8000"],
        projectPath,
        "detected",
        "dev"
      )
    );
  }
  if (markers.includes("run.py")) {
    commands.push(command("python-run", "Run run.py", "python", ["run.py"], projectPath, "detected", "dev"));
  }
  if (markers.includes("app.py") && fastApiEntrypoint?.marker !== "app.py") {
    commands.push(command("python-app", "Run app.py", "python", ["app.py"], projectPath, "detected", "dev"));
  }
  if (markers.includes("main.py") && fastApiEntrypoint?.marker !== "main.py") {
    commands.push(command("python-main", "Run main.py", "python", ["main.py"], projectPath, "detected", "dev"));
  }
  if (markers.includes("go.mod")) {
    commands.push(command("go-run", "Go run", "go", ["run", "."], projectPath, "detected", "dev"));
  }
  if (markers.includes("Cargo.toml")) {
    commands.push(command("cargo-run", "Cargo run", "cargo", ["run"], projectPath, "detected", "dev"));
  }
  if (markers.includes("docker-compose.yml") || markers.includes("compose.yml")) {
    commands.push(command("docker-compose-up", "Docker compose up", "docker", ["compose", "up"], projectPath, "detected", "start"));
  }

  return dedupeCommands(commands);
}

async function detectFastApiEntrypoint(
  projectPath: string,
  markers: string[],
  fs: FileSystemAdapter
): Promise<{ marker: string; module: string } | undefined> {
  for (const marker of ["app/main.py", "main.py", "app.py"]) {
    if (!markers.includes(marker)) continue;
    try {
      const source = await fs.readFile(path.join(projectPath, marker));
      if (!/\bFastAPI\s*\(/.test(source)) continue;
      return { marker, module: marker.replace(/\.py$/, "").replace(/[\\/]/g, ".") };
    } catch {
      // If an entrypoint disappears during scanning, skip it and continue.
    }
  }
  return undefined;
}

async function readPackageScripts(projectPath: string, packageManager: NonNullable<Project["packageManager"]>, fs: FileSystemAdapter): Promise<Command[]> {
  try {
    const raw = await fs.readFile(path.join(projectPath, "package.json"));
    const parsed = JSON.parse(raw) as { scripts?: Record<string, string> };
    return Object.entries(parsed.scripts ?? {}).map(([scriptName, scriptBody]) => {
      return command(
        `script-${scriptName}`,
        scriptName,
        packageManager,
        buildPackageScriptArgs(packageManager, scriptName, scriptBody),
        projectPath,
        "package-script",
        inferCommandKind(scriptName)
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

function command(
  id: string,
  label: string,
  executable: string,
  args: string[],
  cwd: string,
  source: Command["source"],
  kind: Command["kind"]
): Command {
  return { id, label, command: executable, args, cwd, source, kind };
}

function inferCommandKind(name: string): Command["kind"] {
  const normalized = name.toLowerCase();
  if (normalized.includes("test")) return "test";
  if (normalized.includes("build")) return "build";
  if (normalized.includes("start")) return "start";
  if (normalized.includes("dev") || normalized.includes("serve")) return "dev";
  return "custom";
}

function dedupeCommands(commands: Command[]): Command[] {
  const seen = new Set<string>();
  return commands.filter((item) => {
    const key = `${item.command}:${item.args.join(" ")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function readGitInfo(projectPath: string, processAdapter: ProcessAdapter): Promise<GitInfo> {
  const branch = await processAdapter.execFile("git", ["branch", "--show-current"], { cwd: projectPath, timeoutMs: 3000 });
  const status = await processAdapter.execFile("git", ["status", "--short"], { cwd: projectPath, timeoutMs: 5000 });
  const commit = await processAdapter.execFile("git", ["log", "-1", "--pretty=%h %s"], { cwd: projectPath, timeoutMs: 3000 });

  return {
    branch: branch.stdout.trim() || "detached",
    dirtyCount: status.stdout.split(/\r?\n/).filter(Boolean).length,
    lastCommit: commit.stdout.trim() || undefined
  };
}

async function detectPorts(commands: Command[], kind: ProjectKind, processAdapter: ProcessAdapter): Promise<PortStatus[]> {
  const fromCommands = new Set<number>();
  for (const item of commands) {
    const text = `${item.command} ${item.args.join(" ")}`;
    for (const match of text.matchAll(/(?:--port\s+|PORT=|:)(\d{4,5})/gi)) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port < 65536) {
        fromCommands.add(port);
      }
    }
  }

  const candidates = [...fromCommands, ...COMMON_PORTS_BY_KIND[kind]].slice(0, 8);
  const unique = [...new Set(candidates)];
  const statuses: PortStatus[] = [];

  for (const port of unique) {
    statuses.push({
      port,
      status: (await processAdapter.isPortOpen(port)) ? "open" : "closed",
      source: fromCommands.has(port) ? "detected" : "common"
    });
  }

  return statuses;
}
