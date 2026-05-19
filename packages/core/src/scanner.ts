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
  ".env",
  "env",
  ".conda",
  "conda",
  "envs",
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
    "pom.xml",
    "build.gradle",
    "build.gradle.kts",
    "composer.json",
    "artisan",
    "Gemfile",
    "config.ru",
    "Cargo.toml",
    "docker-compose.yml",
    "compose.yml",
    "Dockerfile"
  ].some((marker) => names.has(marker)) || entries.some((entry) => entry.isFile && (entry.name.endsWith(".csproj") || entry.name.endsWith(".sln")));
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
    "requirements.txt",
    "pyproject.toml",
    "manage.py",
    "run.py",
    "app.py",
    "main.py",
    "app/main.py",
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
  if (markers.includes("package.json")) kinds.add("node");
  if (markers.some((marker) => ["requirements.txt", "pyproject.toml", "manage.py", "run.py", "app.py", "main.py", "app/main.py"].includes(marker))) {
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

async function detectPackageManager(projectPath: string, fs: FileSystemAdapter): Promise<Project["packageManager"]> {
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
    const parsed = JSON.parse(raw) as { packageManager?: string };
    const manager = parsed.packageManager?.split("@")[0]?.trim();
    return manager === "npm" || manager === "pnpm" || manager === "yarn" || manager === "bun" ? manager : undefined;
  } catch {
    return undefined;
  }
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
  commands.push(...(await detectJavaCommands(projectPath, markers, fs)));
  commands.push(...(await detectPhpCommands(projectPath, markers, fs)));
  commands.push(...detectRubyCommands(projectPath, markers));
  commands.push(...detectDotnetCommands(projectPath, markers));
  if (markers.includes("Cargo.toml")) {
    commands.push(command("cargo-run", "Cargo run", "cargo", ["run"], projectPath, "detected", "dev"));
  }
  if (markers.includes("docker-compose.yml") || markers.includes("compose.yml")) {
    commands.push(command("docker-compose-up", "Docker compose up", "docker", ["compose", "up"], projectPath, "detected", "start"));
  }

  return dedupeCommands(commands);
}

async function detectJavaCommands(projectPath: string, markers: string[], fs: FileSystemAdapter): Promise<Command[]> {
  const commands: Command[] = [];
  const hasMaven = markers.includes("pom.xml") || markers.includes("mvnw") || markers.includes("mvnw.cmd");
  const hasGradle = markers.some((marker) => ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradlew", "gradlew.bat"].includes(marker));

  if (hasMaven) {
    const mvn = await resolveProjectExecutable(projectPath, fs, ["mvnw.cmd", "mvnw"], "mvn");
    if (await isSpringBootMavenProject(projectPath, fs)) {
      commands.push(command("java-maven-spring-boot-run", "Spring Boot run", mvn, ["spring-boot:run"], projectPath, "detected", "dev"));
    }
    commands.push(command("java-maven-test", "Maven test", mvn, ["test"], projectPath, "detected", "test"));
    commands.push(command("java-maven-package", "Maven package", mvn, ["package"], projectPath, "detected", "build"));
  }

  if (hasGradle) {
    const gradle = await resolveProjectExecutable(projectPath, fs, ["gradlew.bat", "gradlew"], "gradle");
    const springBoot = await isSpringBootGradleProject(projectPath, fs);
    commands.push(command(springBoot ? "java-gradle-boot-run" : "java-gradle-run", springBoot ? "Gradle bootRun" : "Gradle run", gradle, [springBoot ? "bootRun" : "run"], projectPath, "detected", "dev"));
    commands.push(command("java-gradle-test", "Gradle test", gradle, ["test"], projectPath, "detected", "test"));
    commands.push(command("java-gradle-build", "Gradle build", gradle, ["build"], projectPath, "detected", "build"));
  }

  return commands;
}

async function resolveProjectExecutable(projectPath: string, fs: FileSystemAdapter, wrapperNames: string[], fallback: string): Promise<string> {
  for (const wrapperName of wrapperNames) {
    const wrapperPath = path.join(projectPath, wrapperName);
    if (await fs.exists(wrapperPath)) return wrapperPath;
  }
  return fallback;
}

async function isSpringBootMavenProject(projectPath: string, fs: FileSystemAdapter): Promise<boolean> {
  try {
    const pom = await fs.readFile(path.join(projectPath, "pom.xml"));
    return /spring-boot/i.test(pom);
  } catch {
    return false;
  }
}

async function isSpringBootGradleProject(projectPath: string, fs: FileSystemAdapter): Promise<boolean> {
  for (const fileName of ["build.gradle", "build.gradle.kts"]) {
    try {
      const source = await fs.readFile(path.join(projectPath, fileName));
      if (/org\.springframework\.boot|spring-boot/i.test(source)) return true;
    } catch {
      // Keep scanning other Gradle files.
    }
  }
  return false;
}

async function detectPhpCommands(projectPath: string, markers: string[], fs: FileSystemAdapter): Promise<Command[]> {
  const commands: Command[] = [];
  if (markers.includes("artisan")) {
    commands.push(command("php-laravel-serve", "Laravel serve", "php", ["artisan", "serve", "--host", "127.0.0.1", "--port", "8000"], projectPath, "detected", "dev"));
  }
  if (markers.includes("composer.json")) {
    commands.push(...(await readComposerScripts(projectPath, fs)));
  }
  return commands;
}

async function readComposerScripts(projectPath: string, fs: FileSystemAdapter): Promise<Command[]> {
  try {
    const raw = await fs.readFile(path.join(projectPath, "composer.json"));
    const parsed = JSON.parse(raw) as { scripts?: Record<string, unknown> };
    return Object.entries(parsed.scripts ?? {})
      .filter(([scriptName]) => /^(dev|serve|start|test|build)$/i.test(scriptName))
      .map(([scriptName]) =>
        command(`composer-${scriptName}`, `Composer ${scriptName}`, "composer", ["run", scriptName], projectPath, "package-script", inferCommandKind(scriptName))
      );
  } catch {
    return [];
  }
}

function detectRubyCommands(projectPath: string, markers: string[]): Command[] {
  const commands: Command[] = [];
  if (markers.includes("bin/rails")) {
    commands.push(command("ruby-rails-server", "Rails server", "bundle", ["exec", "rails", "server", "-b", "127.0.0.1", "-p", "3000"], projectPath, "detected", "dev"));
  } else if (markers.includes("config.ru")) {
    commands.push(command("ruby-rackup", "Rack server", "bundle", ["exec", "rackup", "-o", "127.0.0.1", "-p", "9292"], projectPath, "detected", "dev"));
  } else if (markers.includes("app.rb")) {
    commands.push(command("ruby-app", "Ruby app.rb", "bundle", ["exec", "ruby", "app.rb"], projectPath, "detected", "dev"));
  }
  if (markers.includes("Gemfile")) {
    commands.push(command("ruby-bundle-test", "Bundle test", "bundle", ["exec", "rake", "test"], projectPath, "detected", "test"));
  }
  return commands;
}

function detectDotnetCommands(projectPath: string, markers: string[]): Command[] {
  if (!markers.some((marker) => marker.endsWith(".csproj") || marker.endsWith(".sln"))) return [];
  return [
    command("dotnet-run", ".NET run", "dotnet", ["run"], projectPath, "detected", "dev"),
    command("dotnet-test", ".NET test", "dotnet", ["test"], projectPath, "detected", "test"),
    command("dotnet-build", ".NET build", "dotnet", ["build"], projectPath, "detected", "build")
  ];
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

async function detectPorts(
  commands: Command[],
  kind: ProjectKind,
  processAdapter: ProcessAdapter,
  portProbeCache: Map<string, Promise<boolean>>
): Promise<PortStatus[]> {
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
