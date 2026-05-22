import type { IncomingMessage, ServerResponse } from "node:http";
import type { ApiLensRecorder } from "./recorder.js";
import { previewPayload, redactHeaders } from "./redaction.js";
import type { ApiLensTarget } from "./types.js";

const MAX_PROXY_BODY_BYTES = 10 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
  "content-length"
]);

export async function handleApiLensProxy(
  req: IncomingMessage,
  res: ServerResponse,
  options: { target: ApiLensTarget; targetPath: string; recorder: ApiLensRecorder }
): Promise<void> {
  const startedAt = new Date().toISOString();
  const started = Date.now();
  const id = options.recorder.createId();
  const method = (req.method ?? "GET").toUpperCase();
  const requestPath = `/${options.targetPath.replace(/^\/+/, "")}${new URL(req.url ?? "/", "http://localhost").search}`;

  try {
    if (method === "OPTIONS" && req.headers["access-control-request-method"]) {
      res.writeHead(204, corsHeaders());
      res.end();
      return;
    }
    const requestBody = await readBodyWithLimit(req, MAX_PROXY_BODY_BYTES);
    const upstreamUrl = createUpstreamUrl(options.target.baseUrl, requestPath);
    const response = await fetch(upstreamUrl, {
      method,
      headers: createForwardHeaders(req.headers),
      body: method === "GET" || method === "HEAD" ? undefined : (requestBody as unknown as BodyInit),
      redirect: "manual"
    });
    const responseBody = Buffer.from(await response.arrayBuffer());
    const responseHeaders = createResponseHeaders(response.headers);
    options.recorder.record({
      id,
      targetId: options.target.id,
      method,
      path: requestPath,
      status: response.status,
      durationMs: Date.now() - started,
      startedAt,
      request: {
        headers: redactHeaders(req.headers),
        body: previewPayload(requestBody, headerValue(req.headers["content-type"]))
      },
      response: {
        headers: redactHeaders(response.headers),
        body: previewPayload(responseBody, response.headers.get("content-type") ?? "")
      }
    });
    res.writeHead(response.status, { ...responseHeaders, ...corsHeaders() });
    res.end(responseBody);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    options.recorder.record({
      id,
      targetId: options.target.id,
      method,
      path: requestPath,
      durationMs: Date.now() - started,
      startedAt,
      request: {
        headers: redactHeaders(req.headers)
      },
      error: message
    });
    const status = message.includes("larger than") ? 413 : 502;
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...corsHeaders() });
    res.end(JSON.stringify({ error: message }));
  }
}

function createUpstreamUrl(baseUrl: string, requestPath: string): string {
  const base = new URL(baseUrl);
  const incoming = new URL(requestPath, "http://local");
  const basePath = base.pathname.replace(/\/+$/, "");
  const nextPath = incoming.pathname.replace(/^\/+/, "");
  base.pathname = [basePath, nextPath].filter(Boolean).join("/");
  base.search = incoming.search;
  return base.toString();
}

function createForwardHeaders(headers: IncomingMessage["headers"]): Headers {
  const output = new Headers();
  for (const [name, value] of Object.entries(headers)) {
    if (!value || HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    if (Array.isArray(value)) {
      for (const item of value) output.append(name, item);
    } else {
      output.set(name, value);
    }
  }
  return output;
}

function createResponseHeaders(headers: Headers): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of headers.entries()) {
    if (HOP_BY_HOP_HEADERS.has(name.toLowerCase())) continue;
    output[name] = value;
  }
  return output;
}

function corsHeaders(): Record<string, string> {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": "*",
    "access-control-expose-headers": "*"
  };
}

async function readBodyWithLimit(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > limit) {
      throw new Error("Request body is larger than 10MB. API Lens does not observe file uploads or large requests yet.");
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function headerValue(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value.join(", ") : value ?? "";
}
