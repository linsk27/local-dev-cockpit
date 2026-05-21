import type { Project } from "../types.js";

export const DEFAULT_IGNORE_NAMES = new Set([
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

export const CHILD_PROJECT_DIRECTORY_HINTS = new Set(["frontend", "front", "backend", "api", "server", "client", "web", "apps", "packages", "services"]);
export const NODE_WORKSPACE_MARKERS = new Set(["pnpm-workspace.yaml", "turbo.json", "nx.json", "lerna.json", "rush.json"]);
export const PYTHON_ENTRYPOINT_MARKERS = [
  "app/main.py",
  "src/app/main.py",
  "main.py",
  "src/main.py",
  "app.py",
  "src/app.py",
  "server.py",
  "api.py",
  "application.py",
  "wsgi.py",
  "asgi.py"
];

export function shouldIgnoreDirectory(name: string, ignoreNames: Set<string>): boolean {
  const normalized = name.toLowerCase();
  return ignoreNames.has(normalized) || /^com\.unity\..+@\d/i.test(name);
}

export function hasProjectMarker(entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>): boolean {
  const names = new Set(entries.filter((entry) => entry.isFile).map((entry) => entry.name));
  return [
    "package.json",
    "pnpm-workspace.yaml",
    "turbo.json",
    "nx.json",
    "lerna.json",
    "rush.json",
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

export function shouldDescendIntoMarkedDirectory(entries: Array<{ name: string; isDirectory: boolean; isFile: boolean }>): boolean {
  const fileNames = new Set(entries.filter((entry) => entry.isFile).map((entry) => entry.name));
  const directoryNames = new Set(entries.filter((entry) => entry.isDirectory).map((entry) => entry.name.toLowerCase()));
  const hasContainerMarker = ["docker-compose.yml", "compose.yml", "Dockerfile"].some((marker) => fileNames.has(marker));
  const hasWorkspaceMarker = [...NODE_WORKSPACE_MARKERS].some((marker) => fileNames.has(marker));
  const hasChildProjectHint = [...CHILD_PROJECT_DIRECTORY_HINTS].some((name) => directoryNames.has(name));
  return hasChildProjectHint && (hasContainerMarker || hasWorkspaceMarker);
}

export function shouldKeepScannedProject(project: Project, reason: "marker" | "git-root"): boolean {
  if (reason === "git-root") return true;
  if (project.commands.length > 0) return true;
  return project.markers.some((marker) => marker !== "package.json");
}
