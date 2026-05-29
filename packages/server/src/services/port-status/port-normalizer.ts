import { type PortStatus, type ProcessRun, type Project } from "@local-dev-cockpit/core";
import { commandLineReferencesProject, type ExternalPortOwner } from "./port-owners.js";
import { externalListenerProbeCandidates, isLocalHttpEndpointReachable, resolveExternalProjectEndpoint } from "./port-probes.js";

/**
 * Keeps detected ports visible only when they are defensible. A declared port is
 * trusted if the OS process command line references this project, or if the
 * unique declared port responds to a lightweight HTTP probe. Otherwise it is
 * marked stale instead of being shown as an online browser endpoint.
 */
export async function normalizeScannedPorts(
  project: Project,
  externalPorts: PortStatus[],
  detectedPortCounts: Map<number, number>
): Promise<PortStatus[]> {
  const externallyMatched = new Set(externalPorts.map((port) => port.port));
  return Promise.all(project.ports.map(async (port) => {
    if (port.source !== "detected" || port.status !== "open") return port;
    if (externallyMatched.has(port.port)) return port;
    if ((detectedPortCounts.get(port.port) ?? 0) > 1) return { ...port, source: "common" };
    const reachable = await resolveReachableScannedPort(port);
    if (reachable) return reachable;
    return { ...port, status: "unknown" };
  }));
}

export function filterStaleLogPorts(
  projectId: string,
  managedRun: ProcessRun | undefined,
  logPorts: PortStatus[],
  externalPorts: PortStatus[],
  externalPortClaims: Map<number, Set<string>>
): PortStatus[] {
  if (managedRun?.status === "running") return logPorts;
  const ownExternallyMatchedPorts = new Set(externalPorts.map((port) => port.port));
  return logPorts.filter((port) => {
    if (ownExternallyMatchedPorts.has(port.port)) return false;
    if (port.status !== "open") return true;
    const claimants = externalPortClaims.get(port.port);
    return !claimants || claimants.size === 0 || claimants.has(projectId);
  });
}

export async function findExternalProjectPorts(project: Project, owners: ExternalPortOwner[], knownPortHints: PortStatus[] = []): Promise<PortStatus[]> {
  const ports = new Map<string, PortStatus>();
  const knownPorts = projectKnownPortNumbers(project, knownPortHints);
  for (const owner of owners) {
    if (!commandLineReferencesProject(owner.commandLine, project.path)) continue;
    const resolved = await resolveExternalProjectEndpoint(owner);
    const isKnownEntrypoint = knownPorts.has(owner.port);
    if (!resolved.reachable && !isKnownEntrypoint) continue;
    const endpoint: PortStatus = {
      port: owner.port,
      host: resolved.host,
      url: resolved.url,
      status: resolved.reachable ? "open" : "unknown",
      source: "detected"
    };
    ports.set(portKey(endpoint), endpoint);
  }
  return [...ports.values()];
}

export function mergePorts(detected: PortStatus[], processPorts: PortStatus[]): PortStatus[] {
  const byPort = new Map<string, PortStatus>();
  for (const port of detected) {
    byPort.set(portKey(port), port);
  }
  for (const port of processPorts) {
    const existingSamePort = [...byPort.values()].filter((existing) => existing.port === port.port);
    if (port.status !== "open" && existingSamePort.some((existing) => existing.status === "open" && existing.source !== "common")) {
      continue;
    }
    for (const [key, existing] of byPort) {
      if (existing.port === port.port && existing.source !== "process") byPort.delete(key);
    }
    byPort.set(portKey(port), port);
  }
  return [...byPort.values()].sort((left, right) => left.port - right.port || (left.host ?? "").localeCompare(right.host ?? ""));
}

async function resolveReachableScannedPort(port: PortStatus): Promise<PortStatus | undefined> {
  for (const candidate of externalListenerProbeCandidates(port.port, port.host)) {
    if (await isLocalHttpEndpointReachable(candidate, 700, { requireUsableContent: true })) {
      return {
        ...port,
        host: candidate.host,
        url: candidate.url,
        status: "open"
      };
    }
  }
  return undefined;
}

function projectKnownPortNumbers(project: Project, hints: PortStatus[]): Set<number> {
  return new Set([
    ...project.ports.filter((port) => port.source !== "common" || port.status === "open").map((port) => port.port),
    ...hints.map((port) => port.port)
  ]);
}

function portKey(port: PortStatus): string {
  return `${port.port}:${port.source}`;
}
