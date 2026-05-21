import path from "node:path";
import type { FileSystemAdapter, ProcessAdapter } from "./adapters.js";
import { NodeFileSystemAdapter, NodeProcessAdapter } from "./node-adapters.js";
import type { Command, GitInfo, PortStatus, Project, ProjectKind, ScanOptions, ScanResult } from "./types.js";
import { detectCommands, detectPackageManager, extractPortNumbersFromText } from "./scanner/commands.js";
import {
  DEFAULT_IGNORE_NAMES,
  NODE_WORKSPACE_MARKERS,
  PYTHON_ENTRYPOINT_MARKERS,
  hasProjectMarker,
  shouldDescendIntoMarkedDirectory,
  shouldIgnoreDirectory,
  shouldKeepScannedProject
} from "./scanner/strategy.js";

export { extractPortNumbersFromText } from "./scanner/commands.js";

const COMMON_PORTS_BY_KIND: Record<ProjectKind, number[]> = {
  node: [3000, 5173, 4173, 8080],
  python: [5000, 8000, 8080],
  java: [8080, 8081, 9090],
  php: [8000, 8080],
  ruby: [3000, 4567, 9292],
  dotnet: [5000, 5001, 7000, 7001, 8080],
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
  const portProbeCache = new Map<string, Promise<boolean>>();

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
      const project = await analyzeProject(candidate.path, { fs, process: processAdapter }, portProbeCache);
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

export async function analyzeProject(
  projectPath: string,
  adapters: Required<ScannerAdapters>,
  portProbeCache = new Map<string, Promise<boolean>>()
): Promise<Project> {
  const markers = await detectMarkers(projectPath, adapters.fs);
  const kind = resolveProjectKind(markers);
  const packageManager = await detectPackageManager(projectPath, adapters.fs);
  const commands = await detectCommands(projectPath, markers, packageManager, adapters.fs);
  const git = await readGitInfo(projectPath, adapters.process);
  const ports = await detectPorts(commands, kind, adapters.process, portProbeCache);

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
    "pnpm-workspace.yaml",
    "turbo.json",
    "nx.json",
    "lerna.json",
    "rush.json",
    "requirements.txt",
    "pyproject.toml",
    "manage.py",
    "run.py",
    ...PYTHON_ENTRYPOINT_MARKERS,
    "go.mod",
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "settings.gradle",
    "settings.gradle.kts",
    "mvnw",
    "mvnw.cmd",
    "gradlew",
    "gradlew.bat",
    "environment.yml",
    "environment.yaml",
    "composer.json",
    "artisan",
    "Gemfile",
    "config.ru",
    "bin/rails",
    "app.rb",
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
  try {
    const entries = await fs.readdir(projectPath);
    for (const entry of entries) {
      if (entry.isFile && (entry.name.endsWith(".csproj") || entry.name.endsWith(".sln"))) {
        found.push(entry.name);
      }
    }
  } catch {
    // Marker detection should be best-effort; the main scanner reports read failures.
  }
  return found;
}

function resolveProjectKind(markers: string[]): ProjectKind {
  const kinds = new Set<ProjectKind>();
  if (markers.includes("package.json") || markers.some((marker) => NODE_WORKSPACE_MARKERS.has(marker))) kinds.add("node");
  if (markers.some((marker) => ["requirements.txt", "pyproject.toml", "manage.py", "run.py", ...PYTHON_ENTRYPOINT_MARKERS].includes(marker))) {
    kinds.add("python");
  }
  if (markers.some((marker) => ["pom.xml", "build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "mvnw", "mvnw.cmd", "gradlew", "gradlew.bat"].includes(marker))) {
    kinds.add("java");
  }
  if (markers.some((marker) => ["composer.json", "artisan"].includes(marker))) kinds.add("php");
  if (markers.some((marker) => ["Gemfile", "config.ru", "bin/rails", "app.rb"].includes(marker))) kinds.add("ruby");
  if (markers.some((marker) => marker.endsWith(".csproj") || marker.endsWith(".sln"))) kinds.add("dotnet");
  if (markers.includes("go.mod")) kinds.add("go");
  if (markers.includes("Cargo.toml")) kinds.add("rust");
  if (markers.some((marker) => ["docker-compose.yml", "compose.yml", "Dockerfile"].includes(marker))) kinds.add("docker");
  if (kinds.size === 0) return "unknown";
  if (kinds.size === 1) return [...kinds][0] ?? "unknown";
  return "mixed";
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

async function detectPorts(
  commands: Command[],
  kind: ProjectKind,
  processAdapter: ProcessAdapter,
  portProbeCache: Map<string, Promise<boolean>>
): Promise<PortStatus[]> {
  const fromCommands = new Set<number>();
  for (const item of commands) {
    for (const port of [...(item.ports ?? []), ...extractPortNumbersFromText(`${item.command} ${item.args.join(" ")}`)]) {
      fromCommands.add(port);
    }
  }

  const candidates = [...fromCommands, ...COMMON_PORTS_BY_KIND[kind]].slice(0, 8);
  const unique = [...new Set(candidates)];
  return Promise.all(
    unique.map(async (port) => ({
      port,
      status: (await cachedPortProbe(processAdapter, port, undefined, portProbeCache)) ? "open" : "closed",
      source: fromCommands.has(port) ? "detected" : "common"
    }))
  );
}

function cachedPortProbe(
  processAdapter: ProcessAdapter,
  port: number,
  host: string | undefined,
  cache: Map<string, Promise<boolean>>
): Promise<boolean> {
  const key = `${host ?? "*"}:${port}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const probe = processAdapter.isPortOpen(port, host);
  cache.set(key, probe);
  return probe;
}
