import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";
import {
  clearApiLensRequests,
  createApiLensTarget,
  deleteApiLensTarget,
  getApiLensRequestContext,
  getApiLensRequests,
  getApiLensTargets
} from "../api";
import { useApiLensStore } from "./api-lens";

vi.mock("../api", () => ({
  clearApiLensRequests: vi.fn(),
  createApiLensTarget: vi.fn(),
  deleteApiLensTarget: vi.fn(),
  getApiLensRequestContext: vi.fn(),
  getApiLensRequests: vi.fn(),
  getApiLensTargets: vi.fn()
}));

describe("api lens store", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.clearAllMocks();
  });

  it("loads targets and selects the first target", async () => {
    vi.mocked(getApiLensTargets).mockResolvedValue([target("target-1")]);
    vi.mocked(getApiLensRequests).mockResolvedValue([request("request-1", "target-1")]);
    const store = useApiLensStore();

    await store.load();

    expect(store.selectedTargetId).toBe("target-1");
    expect(getApiLensRequests).toHaveBeenCalledWith({ targetId: "target-1", limit: 200 });
    expect(store.selectedRequest?.id).toBe("request-1");
  });

  it("creates targets and clears stale request selection", async () => {
    vi.mocked(createApiLensTarget).mockResolvedValue(target("target-2"));
    vi.mocked(getApiLensRequests).mockResolvedValue([]);
    const store = useApiLensStore();
    store.selectedRequestId = "old-request";

    const created = await store.createTarget({ name: "API", baseUrl: "http://127.0.0.1:8000" });

    expect(created?.id).toBe("target-2");
    expect(store.selectedTargetId).toBe("target-2");
    expect(store.selectedRequestId).toBe("");
  });

  it("deletes targets and clears captured requests", async () => {
    vi.mocked(deleteApiLensTarget).mockResolvedValue();
    vi.mocked(clearApiLensRequests).mockResolvedValue();
    vi.mocked(getApiLensRequests).mockResolvedValue([]);
    const store = useApiLensStore();
    store.targets = [target("target-1")];
    store.selectedTargetId = "target-1";
    store.requests = [request("request-1", "target-1")];

    await expect(store.deleteTarget("target-1")).resolves.toBe(true);
    await store.clearRequests();

    expect(store.targets).toEqual([]);
    expect(store.requests).toEqual([]);
    expect(store.error).toBe("");
  });

  it("exposes copied request context", async () => {
    vi.mocked(getApiLensRequestContext).mockResolvedValue("# API Lens Request Context");
    vi.stubGlobal("navigator", {
      clipboard: { writeText: vi.fn().mockResolvedValue(undefined) }
    });
    const store = useApiLensStore();

    await expect(store.copyRequestContext("request-1")).resolves.toContain("API Lens");
  });
});

function target(id: string) {
  return {
    id,
    name: "Local API",
    baseUrl: "http://127.0.0.1:8000",
    createdAt: "2026-05-22T00:00:00.000Z"
  };
}

function request(id: string, targetId: string) {
  return {
    id,
    targetId,
    method: "GET",
    path: "/hello",
    status: 200,
    durationMs: 8,
    startedAt: "2026-05-22T00:00:00.000Z",
    request: { headers: {} }
  };
}
