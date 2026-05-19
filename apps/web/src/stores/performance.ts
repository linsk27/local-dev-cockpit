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

  const level = computed<ResourceLevel>(() => getResourceLevel(snapshot.value));

  function setRoot(nextRootId: string): void {
    if (rootId.value === nextRootId) return;
    rootId.value = nextRootId;
    snapshot.value = null;
  }

  async function refresh(): Promise<void> {
    if (!rootId.value || loading.value) return;
    loading.value = true;
    try {
      snapshot.value = await getPerformance({ rootId: rootId.value });
    } catch {
      // Metrics are diagnostic only; losing this request must not block project work.
    } finally {
      loading.value = false;
    }
  }

  return {
    rootId,
    snapshot,
    loading,
    level,
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
  return `${(value / 1000).toFixed(1)}秒`;
}
