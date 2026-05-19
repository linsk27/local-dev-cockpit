<template>
  <div class="app-shell" :class="{ 'sidebar-collapsed': sidebarCollapsed }">
    <aside class="sidebar">
      <div class="brand">
        <div class="brand-main">
          <div class="brand-mark">DC</div>
          <div class="brand-copy">
            <strong>Dev Cockpit</strong>
            <span>{{ preferences.t("appSubtitle") }}</span>
          </div>
        </div>
        <div class="brand-actions">
          <button
            v-if="updates.hasUpdate"
            class="icon-button update-badge"
            :title="updateTitle"
            type="button"
            @click="openUpdate"
          >
            <Download :size="16" />
          </button>
          <button class="icon-button sidebar-toggle" :title="toggleTitle" type="button" @click="toggleSidebar">
            <PanelLeftOpen v-if="sidebarCollapsed" :size="17" />
            <PanelLeftClose v-else :size="17" />
          </button>
        </div>
      </div>
      <nav class="nav">
        <RouterLink to="/" class="nav-link">
          <LayoutDashboard :size="17" />
          <span class="nav-label">{{ preferences.t("navProjects") }}</span>
        </RouterLink>
        <RouterLink to="/settings" class="nav-link">
          <Settings :size="17" />
          <span class="nav-label">{{ preferences.t("navSettings") }}</span>
        </RouterLink>
      </nav>
      <div class="sidebar-bottom">
        <div class="sidebar-performance" :class="[`level-${performance.level}`, { loading: performance.loading }]" :title="performanceTitle">
          <span class="performance-icon" aria-hidden="true">
            <Activity :size="16" />
          </span>
          <span class="performance-copy">
            <strong>{{ performanceHeadline }}</strong>
            <span>{{ performanceDetail }}</span>
          </span>
        </div>
        <div class="sidebar-footer">
          <span>{{ preferences.t("localOnly") }}</span>
          <span>{{ preferences.t("noCloudSync") }}</span>
        </div>
      </div>
    </aside>
    <main class="main-surface">
      <RouterView />
    </main>
  </div>
  <ToastStack />
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Activity, Download, LayoutDashboard, PanelLeftClose, PanelLeftOpen, Settings } from "lucide-vue-next";
import { formatMetricDuration, usePerformanceStore } from "./stores/performance";
import { usePreferencesStore } from "./stores/preferences";
import { useUpdatesStore } from "./stores/updates";
import ToastStack from "./shared/ui/ToastStack.vue";

const SIDEBAR_KEY = "dev-cockpit:sidebar-collapsed";
const preferences = usePreferencesStore();
const performance = usePerformanceStore();
const updates = useUpdatesStore();
const sidebarCollapsed = ref(readSidebarCollapsed());
const toggleTitle = computed(() =>
  sidebarCollapsed.value ? preferences.t("expandSidebar") : preferences.t("collapseSidebar")
);
const updateTitle = computed(() =>
  updates.result?.latestVersion
    ? preferences.t("updateAvailableTitle", { version: updates.result.latestVersion })
    : preferences.t("updateAvailable")
);
const performanceHeadline = computed(() => {
  if (!performance.snapshot) return preferences.t("resourceMonitor");
  if (performance.level === "high") return preferences.t("resourceHigh");
  if (performance.level === "medium") return preferences.t("resourceMedium");
  return preferences.t("resourceLow");
});
const performanceDetail = computed(() => {
  if (!performance.snapshot) return preferences.t("resourceWaiting");
  return [
    preferences.t("performanceMemory", { memory: performance.snapshot.process.rssMb }),
    preferences.t("performanceScan", { duration: formatMetricDuration(performance.snapshot.scan.lastScanDurationMs) })
  ].join(" · ");
});
const performanceTitle = computed(() => {
  if (!performance.snapshot) return preferences.t("resourceWaiting");
  const { process, scan } = performance.snapshot;
  return [
    preferences.t("performanceTooltip"),
    preferences.t("performanceCpu", { cpu: process.cpuPercent }),
    preferences.t("performanceMemory", { memory: process.rssMb }),
    preferences.t("performanceScan", { duration: formatMetricDuration(scan.lastScanDurationMs) }),
    preferences.t("performanceCache", { hits: scan.cacheHits, misses: scan.cacheMisses })
  ].join("\n");
});

function toggleSidebar(): void {
  sidebarCollapsed.value = !sidebarCollapsed.value;
  localStorage.setItem(SIDEBAR_KEY, String(sidebarCollapsed.value));
}

function openUpdate(): void {
  const target = updates.result?.installerAsset?.downloadUrl ?? updates.result?.releaseUrl;
  if (target) window.open(target, "_blank", "noopener");
}

function readSidebarCollapsed(): boolean {
  return localStorage.getItem(SIDEBAR_KEY) === "true";
}

onMounted(() => {
  void updates.check({ silent: true });
});
</script>
