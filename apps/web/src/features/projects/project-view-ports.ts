import type { Command, PortStatus, Project } from "@local-dev-cockpit/core";

export function visibleProjectPorts(project: Project): PortStatus[] {
  return uniquePortsByNumber(project.ports.filter((port) => port.status === "open" && port.source !== "common"));
}

export function runningProjectPorts(project: Project): PortStatus[] {
  return uniquePortsByNumber(project.ports.filter((port) => port.status === "open" && port.source === "process"));
}

export function stoppableProjectPorts(project: Project): PortStatus[] {
  return uniquePortsByNumber(
    project.ports.filter(
      (port) =>
        port.status === "open" ||
        (port.status === "unknown" && port.source === "detected")
    )
  );
}

export function detectedProjectPorts(project: Project): PortStatus[] {
  return uniquePortsByNumber(project.ports.filter((port) => port.status === "open" && port.source === "detected"));
}

export function staleProjectPorts(project: Project): PortStatus[] {
  return uniquePortsByNumber(project.ports.filter((port) => port.status === "unknown" && port.source === "detected"));
}

export function projectHasStalePorts(project: Project): boolean {
  return visibleProjectPorts(project).length === 0 && staleProjectPorts(project).length > 0;
}

export function commandWouldReuseOpenPort(project: Project, command: Command): boolean {
  if (project.lastRun?.status === "running") return false;
  const openPorts = visibleProjectPorts(project);
  if (openPorts.length === 0) return false;
  if (command.kind === "dev" || command.kind === "start") return true;
  const declaredPorts = commandDeclaredPorts(command);
  if (declaredPorts.length > 0) return declaredPorts.some((port) => openPorts.some((item) => item.port === port));
  return false;
}

export function commandBlockedByStalePort(project: Project, command: Command): boolean {
  if (project.lastRun?.status === "running") return false;
  const stalePorts = staleProjectPorts(project);
  if (stalePorts.length === 0) return false;
  if (command.kind === "dev" || command.kind === "start") return true;
  const declaredPorts = commandDeclaredPorts(command);
  if (declaredPorts.length > 0) return declaredPorts.some((port) => stalePorts.some((item) => item.port === port));
  return false;
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
function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

export function commandDeclaredPorts(command: Command): number[] {
  const ports = new Set<number>(command.ports ?? []);
  const text = `${command.command} ${command.args.join(" ")}`;
  const patterns = [
    /(?:--(?:port|server\.port)(?:=|\s+)|-p\s+|(?:^|\s)[A-Z_]*PORT=)(\d{2,5})/gi,
    /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port);
    }
  }
  return [...ports];
}

function uniquePortsByNumber(ports: PortStatus[]): PortStatus[] {
  const byPort = new Map<number, PortStatus>();
  for (const port of ports) {
    const existing = byPort.get(port.port);
    if (!existing || portDisplayPriority(port) > portDisplayPriority(existing)) {
      byPort.set(port.port, port);
    }
  }
  return [...byPort.values()];
}

function portDisplayPriority(port: PortStatus): number {
  const sourcePriority = port.source === "process" ? 30 : port.source === "detected" ? 20 : 10;
  const urlPriority = port.url ? 2 : port.host ? 1 : 0;
  return sourcePriority + urlPriority;
}
