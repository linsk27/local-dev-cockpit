<template>
  <div
    class="resource-usage"
    :class="[`level-${performance.level}`, { loading: performance.loading, stale: performance.stale }]"
    @mouseenter="showDetails"
    @mouseleave="hideDetails"
    @focusin="showDetails"
    @focusout="hideDetails"
  >
    <button
      class="resource-usage-card"
      type="button"
      :title="tooltip"
      :aria-expanded="detailsOpen"
      @click="toggleDetails"
    >
      <span class="resource-ring" aria-hidden="true">
        <Activity :size="15" />
      </span>
      <span class="resource-copy">
        <strong>{{ headline }}</strong>
        <span>{{ summary }}</span>
      </span>
      <span class="resource-mini-bars" aria-hidden="true">
        <i :style="{ '--value': `${memoryPercent}%` }" />
        <i :style="{ '--value': `${scanPercent}%` }" />
      </span>
    </button>

    <div v-if="detailsOpen" class="resource-popover" role="status">
      <div class="resource-popover-heading">
        <strong>{{ preferences.t("resourceWorkspace") }}</strong>
        <span>{{ freshnessLabel }}</span>
      </div>
      <div class="resource-meter-list">
        <div class="resource-meter">
          <Database :size="14" />
          <span>{{ preferences.t("performanceMemory", { memory: snapshot?.process.rssMb ?? 0 }) }}</span>
          <i :style="{ '--value': `${memoryPercent}%` }" />
        </div>
        <div class="resource-meter">
          <Cpu :size="14" />
          <span>{{ preferences.t("performanceCpu", { cpu: snapshot?.process.cpuSingleCorePercent ?? 0 }) }}</span>
          <i :style="{ '--value': `${cpuPercent}%` }" />
        </div>
        <div class="resource-meter">
          <Timer :size="14" />
          <span>{{ preferences.t("performanceScan", { duration: scanDuration }) }}</span>
          <i :style="{ '--value': `${scanPercent}%` }" />
        </div>
      </div>
      <p>{{ preferences.t("performanceTooltip") }}</p>
      <p v-if="snapshot">{{ preferences.t("performanceCache", { hits: snapshot.scan.cacheHits, misses: snapshot.scan.cacheMisses }) }}</p>
      <p v-if="performance.error" class="resource-warning">{{ preferences.t("resourceStale") }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { Activity, Cpu, Database, Timer } from "lucide-vue-next";
import { formatMetricAge, formatMetricDuration, usePerformanceStore } from "../../stores/performance";
import { usePreferencesStore } from "../../stores/preferences";

const performance = usePerformanceStore();
const preferences = usePreferencesStore();
const detailsOpen = ref(false);

const snapshot = computed(() => performance.snapshot);
const scanDuration = computed(() => formatMetricDuration(snapshot.value?.scan.lastScanDurationMs ?? 0));
const memoryPercent = computed(() => toMeterPercent((snapshot.value?.process.rssMb ?? 0) / 450));
const cpuPercent = computed(() => toMeterPercent((snapshot.value?.process.cpuSingleCorePercent ?? 0) / 100));
const scanPercent = computed(() => toMeterPercent((snapshot.value?.scan.lastScanDurationMs ?? 0) / 15_000));
const freshnessLabel = computed(() => {
  if (!performance.lastOkAt) return preferences.t("resourceWaiting");
  return preferences.t("resourceUpdated", { age: formatMetricAge(performance.lastOkAt, Date.now(), preferences.locale) });
});

const headline = computed(() => {
  if (!snapshot.value && performance.error) return preferences.t("resourceUnavailable");
  if (!snapshot.value) return preferences.t("resourceWorkspace");
  if (performance.stale) return preferences.t("resourceStale");
  if (performance.level === "high") return preferences.t("resourceHigh");
  if (performance.level === "medium") return preferences.t("resourceMedium");
  return preferences.t("resourceLow");
});

const summary = computed(() => {
  if (!snapshot.value) return preferences.t("resourceWaiting");
  return [
    preferences.t("performanceMemory", { memory: snapshot.value.process.rssMb }),
    preferences.t("performanceScan", { duration: scanDuration.value })
  ].join(" · ");
});

const tooltip = computed(() => {
  if (!snapshot.value) return preferences.t("resourceWaiting");
  return [
    preferences.t("performanceTooltip"),
    preferences.t("performanceCpu", { cpu: snapshot.value.process.cpuSingleCorePercent }),
    preferences.t("performanceMemory", { memory: snapshot.value.process.rssMb }),
    preferences.t("performanceScan", { duration: scanDuration.value }),
    preferences.t("performanceCache", { hits: snapshot.value.scan.cacheHits, misses: snapshot.value.scan.cacheMisses })
  ].join("\n");
});

function toggleDetails(): void {
  detailsOpen.value = !detailsOpen.value;
}

function showDetails(): void {
  detailsOpen.value = true;
}

function hideDetails(): void {
  detailsOpen.value = false;
}

function toMeterPercent(value: number): number {
  return Math.max(3, Math.min(100, Math.round(value * 100)));
}
</script>
