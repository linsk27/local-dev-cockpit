import http from "node:http";
import https from "node:https";
import { NodeProcessAdapter, type PortStatus } from "@local-dev-cockpit/core";

export interface ResolvedExternalProjectEndpoint {
  host: string;
  url: string;
  reachable: boolean;
}

export interface LocalProbeEndpoint {
  port: number;
  host: string;
  url: string;
}

export async function resolveExternalProjectEndpoint(owner: Pick<PortStatus, "port" | "host">): Promise<ResolvedExternalProjectEndpoint> {
  const candidates = externalListenerProbeCandidates(owner.port, owner.host);
  for (const candidate of candidates) {
    if (await isLocalHttpEndpointReachable(candidate)) {
      return { ...candidate, reachable: true };
    }
  }
  return { ...candidates[0], reachable: false };
}

export function externalListenerProbeCandidates(port: number, host: string | undefined): LocalProbeEndpoint[] {
  const normalized = normalizePortHost(host ?? "localhost");
  const hosts =
    normalized === "0.0.0.0"
      ? ["127.0.0.1", "localhost"]
      : normalized === "::"
        ? ["127.0.0.1", "::1", "localhost"]
        : normalized === "localhost"
          ? ["127.0.0.1", "localhost", "::1"]
          : normalized
            ? [normalized]
            : ["127.0.0.1", "localhost"];
  const uniqueHosts = [...new Set(hosts)];
  return uniqueHosts.map((candidateHost) => ({
    port,
    host: candidateHost,
    url: formatLocalUrl(port, candidateHost)
  }));
}

export async function isEndpointOpen(processAdapter: NodeProcessAdapter, endpoint: Pick<PortStatus, "port" | "host">): Promise<boolean> {
  if ("url" in endpoint && typeof endpoint.url === "string") {
    return isLocalHttpEndpointReachable(endpoint as Pick<PortStatus, "port" | "host" | "url">);
  }
  if (!endpoint.host || endpoint.host === "localhost") return processAdapter.isPortOpen(endpoint.port);
  return processAdapter.isPortOpen(endpoint.port, endpoint.host);
}

export function isLocalHttpEndpointReachable(endpoint: Pick<PortStatus, "port" | "host" | "url">, timeoutMs = 2500): Promise<boolean> {
  const targetUrl = endpoint.url ?? formatLocalUrl(endpoint.port, endpoint.host ?? "localhost");
  return new Promise((resolve) => {
    let finished = false;
    let request: http.ClientRequest | undefined;
    const finish = (reachable: boolean) => {
      if (finished) return;
      finished = true;
      request?.destroy();
      resolve(reachable);
    };
    let parsed: URL;
    try {
      parsed = new URL(targetUrl);
    } catch {
      resolve(false);
      return;
    }
    const client = parsed.protocol === "https:" ? https : http;
    const options: http.RequestOptions & { rejectUnauthorized?: boolean } = {
      method: "GET",
      timeout: timeoutMs,
      headers: { "user-agent": "Dev-Cockpit/health-check" },
      rejectUnauthorized: false
    };
    request = client.request(
      parsed,
      options,
      (response) => {
        response.resume();
        finish(true);
      }
    );
    request.once("timeout", () => finish(false));
    request.once("error", () => finish(false));
    request.end();
  });
}

export async function resolveReachableEndpoint(
  processAdapter: NodeProcessAdapter,
  endpoint: Pick<PortStatus, "port" | "host" | "url">
): Promise<Pick<PortStatus, "port" | "host" | "url">> {
  if (endpoint.url) return endpoint;
  if (endpoint.host !== "localhost") return endpoint;
  const protocol = endpoint.url?.startsWith("https:") ? "https" : "http";
  if (await processAdapter.isPortOpen(endpoint.port, "127.0.0.1")) {
    return { port: endpoint.port, host: "127.0.0.1", url: `${protocol}://127.0.0.1:${endpoint.port}` };
  }
  if (await processAdapter.isPortOpen(endpoint.port, "::1")) {
    return { port: endpoint.port, host: "::1", url: `${protocol}://[::1]:${endpoint.port}` };
  }
  return endpoint;
}

export function normalizePortHost(host: string): string {
  return host.replace(/^\[|\]$/g, "");
}

function formatLocalUrl(port: number, host: string): string {
  return `http://${host.includes(":") && !host.startsWith("[") ? `[${host}]` : host}:${port}`;
}
