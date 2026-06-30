import type { IncomingMessage, ServerResponse } from "node:http";
import os from "node:os";
import { EXTERNAL_PORT_OWNER_CACHE_TTL_MS } from "../services/port-status.js";
import { PROJECT_SCAN_CACHE_TTL_MS } from "../services/project-scan-cache.js";
import { checkForUpdates } from "../services/update-checker.js";
import { sendJson } from "./shared.js";
import type { ServerRouteContext } from "./types.js";

const startedAt = Date.now();
let cpuSample = { at: startedAt, usage: process.cpuUsage() };

export async function handleSystemRoute(
  method: string,
  url: URL,
  _req: IncomingMessage,
  res: ServerResponse,
  context: ServerRouteContext
): Promise<boolean> {
  if (method === "GET" && url.pathname === "/api/health") {
    sendJson(res, 200, { ok: true, name: "Dev Cockpit", version: context.currentVersion });
    return true;
  }

  if (method === "GET" && url.pathname === "/api/update") {
    sendJson(res, 200, await checkForUpdates(context.currentVersion));
    return true;
  }

  if (method === "GET" && url.pathname === "/api/performance") {
    const scopeKey = url.searchParams.get("rootId") || "all";
    sendJson(res, 200, {
      process: readProcessMetrics(),
      scan: context.projectCache.snapshot(scopeKey),
      polling: {
        projectScanCacheTtlMs: PROJECT_SCAN_CACHE_TTL_MS,
        externalPortOwnerCacheTtlMs: EXTERNAL_PORT_OWNER_CACHE_TTL_MS
      }
    });
    return true;
  }

  return false;
}

function readProcessMetrics() {
  const now = Date.now();
  const usage = process.cpuUsage();
  const elapsedMs = Math.max(1, now - cpuSample.at);
  const cpuDeltaMs = (usage.user - cpuSample.usage.user + usage.system - cpuSample.usage.system) / 1000;
  cpuSample = { at: now, usage };
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    uptimeMs: now - startedAt,
    rssMb: roundOne(memory.rss / 1024 / 1024),
    heapUsedMb: roundOne(memory.heapUsed / 1024 / 1024),
    cpuPercent: roundOne((cpuDeltaMs / elapsedMs / Math.max(1, os.cpus().length)) * 100),
    cpuSingleCorePercent: roundOne((cpuDeltaMs / elapsedMs) * 100)
  };
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
