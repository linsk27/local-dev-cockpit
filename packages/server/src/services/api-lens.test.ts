import { describe, expect, it } from "vitest";
import { ApiLensRecorder } from "./api-lens/recorder.js";
import { createApiLensContext } from "./api-lens/context.js";
import { previewPayload, redactHeaders } from "./api-lens/redaction.js";
import { normalizeTargetBaseUrl } from "./api-lens/targets.js";
import type { ApiLensRequestRecord } from "./api-lens/types.js";

describe("API Lens targets", () => {
  it("accepts localhost and private-network http targets only", () => {
    expect(normalizeTargetBaseUrl("http://127.0.0.1:8000/api/")).toBe("http://127.0.0.1:8000/api");
    expect(normalizeTargetBaseUrl("https://localhost:9443")).toBe("https://localhost:9443");
    expect(normalizeTargetBaseUrl("http://192.168.1.8:3000")).toBe("http://192.168.1.8:3000");
    expect(() => normalizeTargetBaseUrl("ftp://127.0.0.1")).toThrow("http and https");
    expect(() => normalizeTargetBaseUrl("https://example.com")).toThrow("localhost or private-network");
  });
});

describe("API Lens redaction", () => {
  it("redacts sensitive headers and body fields", () => {
    expect(
      redactHeaders({
        authorization: "Bearer secret",
        cookie: "session=secret",
        "x-api-key": "secret",
        accept: "application/json"
      })
    ).toEqual({
      authorization: "[redacted]",
      cookie: "[redacted]",
      "x-api-key": "[redacted]",
      accept: "application/json"
    });

    const preview = previewPayload(
      Buffer.from(JSON.stringify({ username: "edy", password: "secret", nested: { refreshToken: "token" } })),
      "application/json"
    );

    expect(preview?.body).toEqual({
      username: "edy",
      password: "[redacted]",
      nested: { refreshToken: "[redacted]" }
    });
  });

  it("does not store binary body content", () => {
    expect(previewPayload(Buffer.from([1, 2, 3]), "application/octet-stream")).toEqual({
      contentType: "application/octet-stream",
      size: 3,
      truncated: false
    });
  });
});

describe("API Lens recorder", () => {
  it("keeps a per-target ring buffer", () => {
    const recorder = new ApiLensRecorder(2);
    recorder.record(record("a", "one"));
    recorder.record(record("a", "two"));
    recorder.record(record("a", "three"));
    recorder.record(record("b", "four"));

    expect(recorder.list({ targetId: "a" }).map((item) => item.id)).toEqual(["three", "two"]);
    expect(recorder.list({ targetId: "b" }).map((item) => item.id)).toEqual(["four"]);
  });

  it("creates AI handoff context from a captured request", () => {
    const context = createApiLensContext(record("target-1", "request-1"), {
      id: "target-1",
      name: "Local API",
      baseUrl: "http://127.0.0.1:8000",
      createdAt: "2026-05-22T00:00:00.000Z"
    });

    expect(context).toContain("Target: Local API");
    expect(context).toContain("Request: GET /hello");
    expect(context).toContain("Status: 200");
  });
});

function record(targetId: string, id: string): ApiLensRequestRecord {
  return {
    id,
    targetId,
    method: "GET",
    path: "/hello",
    status: 200,
    durationMs: 12,
    startedAt: `2026-05-22T00:00:0${id.length % 10}.000Z`,
    request: {
      headers: { accept: "application/json" }
    },
    response: {
      headers: { "content-type": "application/json" },
      body: { contentType: "application/json", size: 11, truncated: false, body: { ok: true } }
    }
  };
}
