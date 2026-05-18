import type { Command, PortStatus, Project } from "@local-dev-cockpit/core";

export function visibleProjectPorts(project: Project): PortStatus[] {
  return project.ports.filter((port) => port.status === "open" && port.source !== "common");
}

export function runningProjectPorts(project: Project): PortStatus[] {
  return project.ports.filter((port) => port.status === "open" && port.source === "process");
}

export function detectedProjectPorts(project: Project): PortStatus[] {
  return project.ports.filter((port) => port.status === "open" && port.source === "detected");
}

export function commandWouldReuseOpenPort(project: Project, command: Command): boolean {
  if (project.lastRun?.status === "running") return false;
  const openPorts = visibleProjectPorts(project);
  if (openPorts.length === 0) return false;
  const declaredPorts = commandDeclaredPorts(command);
  if (declaredPorts.length > 0) return declaredPorts.some((port) => openPorts.some((item) => item.port === port));
  return command.kind === "dev" || command.kind === "start";
}

export function projectIsOnline(project: Project): boolean {
  return project.lastRun?.status === "running" || visibleProjectPorts(project).length > 0;
}

export function projectHasFailed(project: Project): boolean {
  if (projectHasAlreadyRunningConflict(project)) return false;
  return Boolean(project.lastError) || project.lastRun?.status === "failed";
}

export function projectHasAlreadyRunningConflict(project: Project): boolean {
  const message = project.lastError?.message ?? "";
  return (
    visibleProjectPorts(project).length > 0 &&
    /another .+server.+already running|address.*already in use|eaddrinuse|only one usage|通常每个套接字|port \d+ is in use/i.test(message)
  );
}

export function recommendedProjectCommand(project: Project): Command | undefined {
  const failedCommand = project.lastError?.commandId
    ? project.commands.find((command) => command.id === project.lastError?.commandId)
    : undefined;
  return (
    failedCommand ??
    project.commands.find((command) => command.kind === "dev") ??
    project.commands.find((command) => command.kind === "start") ??
    project.commands[0]
  );
}

export function formatPortEndpoint(port: Pick<PortStatus, "port" | "host">): string {
  return port.host ? `${port.host}:${port.port}` : String(port.port);
}

export function formatPortUrl(port: Pick<PortStatus, "port" | "host" | "url">): string {
  if (port.url) return port.url;
  const host = port.host ? formatUrlHost(port.host) : "localhost";
  return `http://${host}:${port.port}`;
}

export function countOpenPortsByNumber(projects: Project[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const project of projects) {
    const uniquePorts = new Set(visibleProjectPorts(project).map((port) => port.port));
    for (const port of uniquePorts) {
      counts.set(port, (counts.get(port) ?? 0) + 1);
    }
  }
  return counts;
}

export function hasPortConflict(project: Project, openPortCounts: Map<number, number>): boolean {
  return visibleProjectPorts(project).some((port) => (openPortCounts.get(port.port) ?? 0) > 1);
}

export function sortProjectsForDashboard(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => {
    const onlineDelta = Number(projectIsOnline(right)) - Number(projectIsOnline(left));
    if (onlineDelta !== 0) return onlineDelta;

    const errorDelta = Number(projectHasFailed(right)) - Number(projectHasFailed(left));
    if (errorDelta !== 0) return errorDelta;

    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export function projectMatchesQuery(project: Project, query: string): boolean {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return true;

  const searchable = [
    project.name,
    project.path,
    project.kind,
    project.git.branch,
    project.packageManager ?? "",
    ...project.markers,
    ...project.commands.flatMap((command) => [command.label, command.kind, command.command, command.args.join(" ")]),
    ...project.ports.map(formatPortEndpoint)
  ]
    .map(normalize)
    .join(" ");

  return searchable.includes(normalizedQuery);
}

export function projectBelongsToRoot(project: Project, rootPath: string): boolean {
  const projectPath = normalizePath(project.path);
  const root = normalizePath(rootPath);
  return projectPath === root || projectPath.startsWith(`${root}/`);
}

export function formatDisplayPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\\\\")) {
    return `\\\\${trimmed.slice(2).replace(/\\{2,}/g, "\\")}`;
  }
  return trimmed.replace(/\\{2,}/g, "\\");
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function commandDeclaredPorts(command: Command): number[] {
  const text = `${command.command} ${command.args.join(" ")}`;
  const ports = new Set<number>();
  for (const match of text.matchAll(/(?:--port(?:=|\s+)|-p\s+|PORT=|:)(\d{2,5})/gi)) {
    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port);
  }
  return [...ports];
}
