import { Readable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { describe, expect, it, vi } from "vitest";
import { handleApiRoute } from "./routes.js";
import type { ServerRouteContext } from "./routes/types.js";

describe("handleApiRoute", () => {
  it("dispatches resource summary requests to the resource route", async () => {
    const res = response();
    const summary = { total: 2, statuses: { inbox: 2 }, kinds: {}, categories: [] };
    const context = routeContext({
      skillRadar: {
        summary: vi.fn().mockResolvedValue(summary)
      }
    });

    await expect(handleApiRoute(request("GET", "/api/skills?summary=1"), res.raw, context)).resolves.toBe(true);

    expect(res.status).toBe(200);
    expect(res.json()).toEqual(summary);
    expect(context.skillRadar.summary).toHaveBeenCalledOnce();
  });

  it("returns false for unknown API routes", async () => {
    const res = response();

    await expect(handleApiRoute(request("GET", "/api/unknown"), res.raw, routeContext())).resolves.toBe(false);

    expect(res.status).toBe(0);
    expect(res.body).toBe("");
  });
});

function request(method: string, url: string, body?: unknown): IncomingMessage {
  const stream = Readable.from(body === undefined ? [] : [JSON.stringify(body)]);
  return Object.assign(stream, { method, url }) as IncomingMessage;
}

function response(): { body: string; json: () => unknown; raw: ServerResponse; status: number } {
  const state = {
    body: "",
    status: 0,
    json: () => JSON.parse(state.body) as unknown,
    raw: {
      writeHead(status: number) {
        state.status = status;
      },
      end(chunk: unknown) {
        state.body = String(chunk ?? "");
      }
    } as ServerResponse
  };
  return state;
}

function routeContext(overrides: { skillRadar?: Record<string, unknown> } = {}): ServerRouteContext {
  const base = {
    currentVersion: "0.0.0",
    processManager: {},
    projectCache: {},
    skillRadar: {
      summary: vi.fn().mockResolvedValue({ total: 0, statuses: {}, kinds: {}, categories: [] }),
      list: vi.fn().mockResolvedValue([])
    },
    store: {}
  };
  return {
    ...base,
    skillRadar: {
      ...base.skillRadar,
      ...overrides.skillRadar
    }
  } as unknown as ServerRouteContext;
}
