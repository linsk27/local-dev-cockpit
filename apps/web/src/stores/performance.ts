import { computed, ref } from "vue";
import { defineStore } from "pinia";
import { getPerformance, type PerformanceSnapshot } from "../api";

export type ResourceLevel = "low" | "medium" | "high";

/**
 * Shares Dev Cockpit's own resource metrics between the dashboard and the
 * global shell. The endpoint is intentionally read-only and does not trigger a
 * project scan, so it is safe to poll at a low frequency.
 */
export const usePerformanceStore = defineStore("performance", () => {
  const rootId = ref("");
  const snapshot = ref<PerformanceSnapshot | null>(null);
  const loading = ref(false);
  const error = ref("");
  const updatedAt = ref(0);
  const lastOkAt = ref(0);

  const level = computed<ResourceLevel>(() => getResourceLevel(snapshot.value));
  const stale = computed(() => {
    if (!snapshot.value || !lastOkAt.value) return false;
    return Boolean(error.value) || Date.now() - lastOkAt.value > 20_000;
  });

  function setRoot(nextRootId: string): void {
    if (rootId.value === nextRootId) return;
    rootId.value = nextRootId;
    snapshot.value = null;
    error.value = "";
    updatedAt.value = 0;
    lastOkAt.value = 0;
  }

  async function refresh(): Promise<void> {
    if (!rootId.value || loading.value) return;
    loading.value = true;
    try {
      snapshot.value = await getPerformance({ rootId: rootId.value });
      error.value = "";
      lastOkAt.value = Date.now();
    } catch {
      // Metrics are diagnostic only; losing this request must not block project work.
      error.value = "Failed to load performance metrics";
    } finally {
      updatedAt.value = Date.now();
      loading.value = false;
    }
  }

  return {
    rootId,
    snapshot,
    loading,
    error,
    updatedAt,
    lastOkAt,
    level,
    stale,
    setRoot,
    refresh
  };
});

export function getResourceLevel(snapshot: PerformanceSnapshot | null): ResourceLevel {
  if (!snapshot) return "low";
  const { rssMb, cpuSingleCorePercent } = snapshot.process;
  const scanMs = snapshot.scan.lastScanDurationMs;
  if (rssMb > 450 || cpuSingleCorePercent > 60 || scanMs > 15_000) return "high";
  if (rssMb > 220 || cpuSingleCorePercent > 20 || scanMs > 6_000) return "medium";
  return "low";
}

export function formatMetricDuration(value: number): string {
  if (value <= 0) return "0ms";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

export function formatMetricAge(timestamp: number, now = Date.now(), locale: "zh-CN" | "en-US" = "en-US"): string {
  if (!timestamp) return "";
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (locale === "zh-CN") {
    if (seconds < 5) return "刚刚";
    if (seconds < 60) return `${seconds}秒前`;
    return `${Math.round(seconds / 60)}分钟前`;
  }
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  return `${Math.round(seconds / 60)}m ago`;
}
