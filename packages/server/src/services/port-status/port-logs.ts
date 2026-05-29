import path from "node:path";
import { NodeProcessAdapter, type PortStatus, type ProcessRun } from "@local-dev-cockpit/core";
import { stripAnsiControlSequences } from "../../log-decoder.js";
import { isLocalHttpEndpointReachable, normalizePortHost, resolveReachableEndpoint } from "./port-probes.js";

export async function extractPortsFromLogs(logs: string, status: ProcessRun["status"], projectPath: string): Promise<PortStatus[]> {
  const ports = new Map<string, Pick<PortStatus, "port" | "host" | "url">>();
  const cleanLogs = stripAnsiControlSequences(logs);
  const processAdapter = new NodeProcessAdapter();
  const existingServer = logIndicatesExistingServer(cleanLogs, projectPath);

  for (const endpoint of parseLocalEndpointsFromLogs(cleanLogs)) {
    const resolved = await resolveReachableEndpoint(processAdapter, endpoint);
    ports.set(`${resolved.host ?? "host"}:${resolved.port}`, resolved);
  }

  const statuses: PortStatus[] = [];
  const shouldProbeEndpoint = status === "running" || existingServer;
  for (const endpoint of ports.values()) {
    const isOpen =
      shouldProbeEndpoint &&
      (await isLocalHttpEndpointReachable(endpoint, 700, {
        requireUsableContent: true
      }));
    statuses.push({
      ...endpoint,
      status: isOpen ? "open" : "closed",
      source: status === "running" ? "process" : "detected"
    });
  }
  return statuses;
}

export function parseLocalEndpointsFromLogs(logs: string): Pick<PortStatus, "port" | "host" | "url">[] {
  const ports = new Map<string, Pick<PortStatus, "port" | "host" | "url">>();
  for (const match of logs.matchAll(/https?:\/\/(?:localhost|127\.0\.0\.1|\[::1\])(?::\d{2,5})?(?:\/[^\s]*)?/gi)) {
    try {
      const url = new URL(match[0]);
      if (!url.port) continue;
      const port = Number(url.port);
      if (Number.isInteger(port) && port > 0 && port < 65536) {
        const host = normalizePortHost(url.hostname);
        const endpoint = {
          port,
          host,
          url: `${url.protocol}//${url.host}`
        };
        ports.set(`${endpoint.host ?? "host"}:${endpoint.port}`, endpoint);
      }
    } catch {
      // Ignore partial URLs emitted by colored terminal output.
    }
  }
  return [...ports.values()];
}

export function logIndicatesExistingServer(logs: string, projectPath?: string): boolean {
  if (/another .+server.+already running/i.test(logs) && projectPath) {
    const existingDir = parseExistingServerDir(logs);
    if (existingDir && normalizeComparablePath(existingDir) !== normalizeComparablePath(projectPath)) return false;
  }
  return /another .+server.+already running|already running|address already in use|eaddrinuse|port \d+ is in use/i.test(logs);
}

function parseExistingServerDir(logs: string): string | undefined {
  const match = logs.match(/^\s*-\s*Dir:\s*(.+?)\s*$/im) ?? logs.match(/\bDir:\s*([A-Za-z]:\\.+?)(?:\s+-\s+|\s+Run\s+|$)/i);
  return match?.[1]?.trim();
}

function normalizeComparablePath(value: string): string {
  return path.resolve(value).replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}
