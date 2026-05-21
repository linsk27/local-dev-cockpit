import type { Project } from "@local-dev-cockpit/core";

export const PROJECT_SCAN_CACHE_TTL_MS = 20_000;

export interface ProjectScanSnapshot {
  scope: string;
  status: "empty" | "cached" | "scanning" | "stale";
  cacheExpiresInMs: number;
  lastScanDurationMs: number;
  lastProjectCount: number;
  lastScannedAt?: string;
  cacheHits: number;
  cacheMisses: number;
  joinedRequests: number;
}

interface ProjectScanCacheEntry {
  expiresAt: number;
  projects?: Project[];
  inflight?: Promise<Project[]>;
  hits: number;
  misses: number;
  joined: number;
  lastScanDurationMs: number;
  lastProjectCount: number;
  lastScannedAt?: string;
}

/**
 * Short-lived project scan cache. It prevents repeated UI polling from
 * triggering full filesystem scans while still allowing manual refresh to
 * bypass stale data.
 */
export class ProjectScanCache {
  private readonly entries = new Map<string, ProjectScanCacheEntry>();

  constructor(private readonly ttlMs = PROJECT_SCAN_CACHE_TTL_MS) {}

  async get(key: string, force: boolean, load: () => Promise<Project[]>): Promise<Project[]> {
    const now = Date.now();
    const entry = this.entry(key);
    if (!force && entry.projects && entry.expiresAt > now) {
      entry.hits += 1;
      return entry.projects;
    }
    if (!force && entry.inflight) {
      entry.joined += 1;
      return entry.inflight;
    }

    entry.misses += 1;
    const started = Date.now();
    entry.inflight = load()
      .then((projects) => {
        entry.projects = projects;
        entry.expiresAt = Date.now() + this.ttlMs;
        entry.lastScanDurationMs = Date.now() - started;
        entry.lastProjectCount = projects.length;
        entry.lastScannedAt = new Date().toISOString();
        return projects;
      })
      .finally(() => {
        entry.inflight = undefined;
      });
    return entry.inflight;
  }

  invalidate(): void {
    for (const entry of this.entries.values()) {
      entry.expiresAt = 0;
    }
  }

  snapshot(key: string): ProjectScanSnapshot {
    const entry = this.entries.get(key);
    const now = Date.now();
    return {
      scope: key,
      status: entry?.inflight ? "scanning" : entry?.projects && entry.expiresAt > now ? "cached" : entry?.projects ? "stale" : "empty",
      cacheExpiresInMs: entry?.projects ? Math.max(0, entry.expiresAt - now) : 0,
      lastScanDurationMs: entry?.lastScanDurationMs ?? 0,
      lastProjectCount: entry?.lastProjectCount ?? 0,
      lastScannedAt: entry?.lastScannedAt,
      cacheHits: entry?.hits ?? 0,
      cacheMisses: entry?.misses ?? 0,
      joinedRequests: entry?.joined ?? 0
    };
  }

  private entry(key: string): ProjectScanCacheEntry {
    const current = this.entries.get(key);
    if (current) return current;
    const next: ProjectScanCacheEntry = {
      expiresAt: 0,
      hits: 0,
      misses: 0,
      joined: 0,
      lastScanDurationMs: 0,
      lastProjectCount: 0
    };
    this.entries.set(key, next);
    return next;
  }
}
