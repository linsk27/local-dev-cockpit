import type { ApiLensPayloadPreview } from "./types.js";

const SENSITIVE_HEADER_NAMES = new Set(["authorization", "cookie", "set-cookie", "x-api-key"]);
const SENSITIVE_BODY_KEYS = new Set(["password", "token", "secret", "authorization", "cookie"]);
const TEXT_PREVIEW_LIMIT_BYTES = 64 * 1024;

export function redactHeaders(headers: Headers | Record<string, string | string[] | undefined>): Record<string, string> {
  const entries = headers instanceof Headers ? [...headers.entries()] : Object.entries(headers);
  const redacted: Record<string, string> = {};
  for (const [name, rawValue] of entries) {
    if (!rawValue) continue;
    const value = Array.isArray(rawValue) ? rawValue.join(", ") : String(rawValue);
    redacted[name.toLowerCase()] = SENSITIVE_HEADER_NAMES.has(name.toLowerCase()) ? "[redacted]" : value;
  }
  return redacted;
}

export function previewPayload(body: Buffer, contentType = ""): ApiLensPayloadPreview | undefined {
  if (body.length === 0) return undefined;
  const normalizedType = contentType.toLowerCase();
  if (!isTextLikeContent(normalizedType)) {
    return {
      contentType,
      size: body.length,
      truncated: body.length > TEXT_PREVIEW_LIMIT_BYTES
    };
  }
  const truncated = body.length > TEXT_PREVIEW_LIMIT_BYTES;
  const text = body.subarray(0, TEXT_PREVIEW_LIMIT_BYTES).toString("utf8");
  const parsed = parseTextPreview(text, normalizedType);
  return {
    contentType,
    size: body.length,
    truncated,
    body: parsed
  };
}

function isTextLikeContent(contentType: string): boolean {
  return (
    contentType.includes("json") ||
    contentType.startsWith("text/") ||
    contentType.includes("xml") ||
    contentType.includes("x-www-form-urlencoded")
  );
}

function parseTextPreview(text: string, contentType: string): unknown {
  if (contentType.includes("json")) {
    try {
      return redactBodyValue(JSON.parse(text));
    } catch {
      return text;
    }
  }
  if (contentType.includes("x-www-form-urlencoded")) {
    return redactFormText(text);
  }
  return text;
}

function redactFormText(text: string): Record<string, string> {
  const params = new URLSearchParams(text);
  const output: Record<string, string> = {};
  for (const [key, value] of params.entries()) {
    output[key] = isSensitiveKey(key) ? "[redacted]" : value;
  }
  return output;
}

function redactBodyValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactBodyValue);
  if (!value || typeof value !== "object") return value;
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    output[key] = isSensitiveKey(key) ? "[redacted]" : redactBodyValue(raw);
  }
  return output;
}

function isSensitiveKey(key: string): boolean {
  const normalized = key.toLowerCase();
  return [...SENSITIVE_BODY_KEYS].some((sensitive) => normalized.includes(sensitive));
}
