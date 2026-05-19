import { describe, expect, it } from "vitest";
import type { PerformanceSnapshot } from "../api";
import { formatMetricDuration, getResourceLevel } from "./performance";

describe("performance metrics", () => {
  it("keeps small overhead in the low bucket", () => {
    expect(getResourceLevel(snapshot({ rssMb: 82, cpuSingleCorePercent: 2, scanMs: 900 }))).toBe("low");
  });

  it("raises the level when memory, CPU, or scan cost is high", () => {
    expect(getResourceLevel(snapshot({ rssMb: 230, cpuSingleCorePercent: 2, scanMs: 900 }))).toBe("medium");
    expect(getResourceLevel(snapshot({ rssMb: 90, cpuSingleCorePercent: 70, scanMs: 900 }))).toBe("high");
  });

  it("formats scan duration for compact sidebar display", () => {
    expect(formatMetricDuration(240)).toBe("240ms");
    expect(formatMetricDuration(1450)).toBe("1.4秒");
  });
});

function snapshot(options: { rssMb: number; cpuSingleCorePercent: number; scanMs: number }): PerformanceSnapshot {
  return {
    process: {
      pid: 1,
      uptimeMs: 1000,
      rssMb: options.rssMb,
      heapUsedMb: 24,
      cpuPercent: 1,
      cpuSingleCorePercent: options.cpuSingleCorePercent
    },
    scan: {
      scope: "D:\\projects",
      status: "cached",
      cacheExpiresInMs: 2000,
      lastScanDurationMs: options.scanMs,
      lastProjectCount: 3,
      cacheHits: 1,
      cacheMisses: 0,
      joinedRequests: 0
    },
    polling: {
      projectScanCacheTtlMs: 15_000,
      externalPortOwnerCacheTtlMs: 10_000
    }
  };
}
