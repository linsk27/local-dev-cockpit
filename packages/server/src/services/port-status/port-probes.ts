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
    if (await isLocalHttpEndpointReachable(candidate, 2500, { requireUsableContent: true })) {
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

export function isLocalHttpEndpointReachable(
  endpoint: Pick<PortStatus, "port" | "host" | "url">,
  timeoutMs = 2500,
  options: { requireUsableContent?: boolean } = {}
): Promise<boolean> {
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
    const requestOptions: http.RequestOptions & { rejectUnauthorized?: boolean } = {
      method: "GET",
      timeout: timeoutMs,
      headers: { "user-agent": "Dev-Cockpit/health-check" },
      rejectUnauthorized: false
    };
    request = client.request(
      parsed,
      requestOptions,
      (response) => {
        if (!options.requireUsableContent) {
          response.resume();
          finish(true);
          return;
        }
        const headerDecision = responseHeadersLookLikeUsableEndpoint(response);
        if (headerDecision !== undefined) {
          response.resume();
          finish(headerDecision);
          return;
        }
        let observedBytes = 0;
        response.on("data", (chunk: Buffer | string) => {
          observedBytes += Buffer.byteLength(chunk);
          if (observedBytes > SMALL_AUXILIARY_RESPONSE_BYTES) {
            response.resume();
            finish(true);
          }
        });
        response.once("end", () => finish(false));
        response.once("error", () => finish(false));
      }
    );
    request.once("timeout", () => finish(false));
    request.once("error", () => finish(false));
    request.end();
  });
}

const SMALL_AUXILIARY_RESPONSE_BYTES = 32;

function responseHeadersLookLikeUsableEndpoint(response: http.IncomingMessage): boolean | undefined {
  const contentType = headerValue(response.headers["content-type"]).toLowerCase();
  if (contentType.length > 0) return true;
  const contentLength = Number(headerValue(response.headers["content-length"]));
  if (!Number.isFinite(contentLength) || contentLength <= 0) return undefined;
  return contentLength > SMALL_AUXILIARY_RESPONSE_BYTES;
}

function headerValue(value: string | string[] | number | undefined): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return typeof value === "number" ? String(value) : value ?? "";
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
