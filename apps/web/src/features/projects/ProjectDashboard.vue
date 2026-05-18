<template>
  <section class="workspace">
    <header class="workspace-header">
      <div>
        <p class="eyebrow">{{ preferences.t("projectsEyebrow") }}</p>
        <h1>{{ preferences.t("projectsTitle") }}</h1>
      </div>
      <div class="header-actions">
        <div v-if="performanceLabel" class="performance-pill" :title="performanceTitle">
          <Activity :size="15" />
          <span>{{ performanceLabel }}</span>
        </div>
        <div v-if="roots.length > 0" ref="rootFilterRef" class="root-filter">
          <button
            class="root-filter-button"
            type="button"
            :aria-label="preferences.t('rootFilterLabel')"
            :aria-expanded="rootMenuOpen"
            @click.stop="toggleRootMenu"
          >
            <FolderOpen :size="16" />
            <span>{{ selectedRootLabel }}</span>
            <ChevronDown :size="15" />
          </button>
          <div v-if="rootMenuOpen" class="root-menu" role="menu">
            <button
              v-for="option in rootOptions"
              :key="option.id"
              class="root-menu-item"
              :class="{ active: option.id === selectedRootId }"
              type="button"
              role="menuitemradio"
              :aria-checked="option.id === selectedRootId"
              @click="selectRoot(option.id)"
            >
              <span>{{ option.label }}</span>
              <Check v-if="option.id === selectedRootId" :size="15" />
            </button>
          </div>
        </div>
        <label class="search-box">
          <Search :size="16" />
          <input v-model="searchQuery" :placeholder="preferences.t('projectSearchPlaceholder')" />
        </label>
        <button class="icon-button" :class="{ spinning: store.loading }" :title="preferences.t('refreshProjects')" @click="refreshProjects">
          <RefreshCw :size="18" />
        </button>
      </div>
    </header>

    <div v-if="store.error" class="error-banner">{{ store.error }}</div>

    <div class="dashboard-grid">
      <ProjectList
        :projects="visibleProjects"
        :total-count="scopedProjects.length"
        :selected-id="activeProject?.id"
        @select="store.select"
      />
      <ProjectDetail v-if="activeProject" :project="activeProject" />
      <section v-else-if="store.loading" class="empty-state">
        <RefreshCw :size="34" class="spin-icon" />
        <h2>{{ preferences.t("loadingProjects") }}</h2>
      </section>
      <section v-else-if="searchQuery" class="empty-state">
        <FolderSearch :size="34" />
        <h2>{{ preferences.t("projectSearchEmptyTitle") }}</h2>
        <p>{{ preferences.t("projectSearchEmptyDescription") }}</p>
      </section>
      <section v-else class="empty-state">
        <FolderSearch :size="34" />
        <h2>{{ preferences.t("emptyTitle") }}</h2>
        <p>{{ preferences.t("emptyDescription") }}</p>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Activity, Check, ChevronDown, FolderOpen, FolderSearch, RefreshCw, Search } from "lucide-vue-next";
import { getPerformance, getRoots, type PerformanceSnapshot, type RootEntry } from "../../api";
import { useNotificationsStore } from "../../stores/notifications";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";
import ProjectDetail from "./ProjectDetail.vue";
import ProjectList from "./ProjectList.vue";
import { formatDisplayPath, projectMatchesQuery, sortProjectsForDashboard } from "./project-view";

const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const searchQuery = ref("");
const selectedRootId = ref("");
const roots = ref<RootEntry[]>([]);
const rootMenuOpen = ref(false);
const rootFilterRef = ref<HTMLElement | null>(null);
const performance = ref<PerformanceSnapshot | null>(null);
const RUNTIME_REFRESH_INTERVAL_MS = 3_000;
const OVERVIEW_REFRESH_INTERVAL_MS = 30_000;
const PERFORMANCE_REFRESH_INTERVAL_MS = 5_000;
const FOCUS_REFRESH_STALE_MS = 10_000;

const rootOptions = computed(() => roots.value.map((root) => ({ id: root.id, label: formatDisplayPath(root.path) })));

const selectedRootLabel = computed(() => rootOptions.value.find((option) => option.id === selectedRootId.value)?.label ?? preferences.t("selectRootOption"));

const scopedProjects = computed(() => store.projects);

const visibleProjects = computed(() => sortProjectsForDashboard(scopedProjects.value).filter((project) => projectMatchesQuery(project, searchQuery.value)));

const hasRunningProject = computed(() => store.projects.some((project) => project.lastRun?.status === "running"));
const hasRuntimeWatch = computed(() => hasRunningProject.value || Object.keys(store.runtimeWatches).length > 0);

const activeProject = computed(() => {
  return visibleProjects.value.find((project) => project.id === store.selectedId) ?? visibleProjects.value[0];
});

const performanceLabel = computed(() => {
  if (!performance.value) return "";
  return `性能 ${performance.value.process.rssMb}MB · CPU ${performance.value.process.cpuPercent}% · 扫描 ${formatMs(performance.value.scan.lastScanDurationMs)}`;
});

const performanceTitle = computed(() => {
  if (!performance.value) return "";
  const scan = performance.value.scan;
  return [
    `扫描状态：${scan.status}`,
    `项目数：${scan.lastProjectCount}`,
    `缓存剩余：${formatMs(scan.cacheExpiresInMs)}`,
    `缓存命中：${scan.cacheHits}`,
    `缓存未命中：${scan.cacheMisses}`,
    `合并请求：${scan.joinedRequests}`,
    `进程 PID：${performance.value.process.pid}`,
    `堆内存：${performance.value.process.heapUsedMb}MB`,
    `单核 CPU：${performance.value.process.cpuSingleCorePercent}%`
  ].join("\n");
});

watch(
  () => activeProject.value?.id,
  (projectId) => {
    if (projectId && projectId !== store.selectedId) store.select(projectId);
  }
);

watch(
  () => roots.value.map((root) => root.id).join("|"),
  () => {
    ensureSelectedRoot();
  }
);

let runtimeRefreshTimer: number | undefined;
let overviewRefreshTimer: number | undefined;
let performanceRefreshTimer: number | undefined;
let lastOverviewRefreshAt = 0;
const notifiedFailedRunIds = new Set<string>();

async function refreshRuntimeState(): Promise<void> {
  if (document.visibilityState === "hidden") return;
  if (!hasRuntimeWatch.value) return;
  const watchedBefore = captureWatchedRuns();
  await Promise.all([...watchedBefore.keys()].map((projectId) => store.refreshProject(projectId)));
  notifyFailedRuns(watchedBefore);
  const selectedProject = store.selectedProject;
  const selectedRun = selectedProject?.lastRun;
  if (selectedProject && selectedRun && (selectedRun.status === "running" || watchedBefore.get(selectedProject.id) === selectedRun.id)) {
    await store.loadLogs(selectedRun.id);
  }
  store.pruneRuntimeWatches();
}

async function refreshExternalProjectState(): Promise<void> {
  if (document.visibilityState === "hidden") return;
  if (store.loading || store.refreshing) return;
  if (!selectedRootId.value) return;
  const refreshed = await store.refresh({ silent: true, rootId: selectedRootId.value });
  if (refreshed) lastOverviewRefreshAt = Date.now();
  await loadPerformance();
}

async function refreshProjects(): Promise<void> {
  await loadRoots();
  if (!selectedRootId.value) {
    store.projects = [];
    store.selectedId = "";
    return;
  }
  const refreshed = await store.refresh({ force: true, rootId: selectedRootId.value });
  if (refreshed) {
    lastOverviewRefreshAt = Date.now();
    await loadPerformance();
    notifications.success(preferences.t("projectsRefreshedNotice", { count: scopedProjects.value.length }));
  } else {
    notifications.error(preferences.t("refreshFailedNotice", { message: store.error || preferences.t("refreshProjects") }));
  }
}

async function loadRoots(): Promise<void> {
  try {
    roots.value = await getRoots();
    ensureSelectedRoot();
  } catch (error) {
    notifications.error(preferences.t("rootActionFailedNotice", { message: error instanceof Error ? error.message : String(error) }));
  }
}

function toggleRootMenu(): void {
  rootMenuOpen.value = !rootMenuOpen.value;
}

function selectRoot(rootId: string): void {
  selectedRootId.value = rootId;
  rootMenuOpen.value = false;
  store.projects = [];
  store.selectedId = "";
  void initialRefresh();
}

function closeRootMenuOnOutsideClick(event: MouseEvent): void {
  if (!rootFilterRef.value?.contains(event.target as Node)) {
    rootMenuOpen.value = false;
  }
}

function closeRootMenuOnEscape(event: KeyboardEvent): void {
  if (event.key === "Escape") rootMenuOpen.value = false;
}

function captureWatchedRuns(): Map<string, string> {
  const watched = new Map<string, string>();
  for (const project of store.projects) {
    if (project.lastRun?.status === "running") watched.set(project.id, project.lastRun.id);
  }
  for (const [projectId, runId] of Object.entries(store.runtimeWatches)) {
    watched.set(projectId, runId);
  }
  return watched;
}

function notifyFailedRuns(watchedBefore: Map<string, string>): void {
  for (const project of store.projects) {
    const run = project.lastRun;
    if (run?.status !== "failed" || watchedBefore.get(project.id) !== run.id || notifiedFailedRunIds.has(run.id)) continue;
    notifiedFailedRunIds.add(run.id);
    notifications.error(`命令失败：${project.name} - ${project.lastError?.message ?? "请查看日志"}`);
  }
}

async function initialRefresh(): Promise<void> {
  if (!selectedRootId.value) {
    store.projects = [];
    store.selectedId = "";
    return;
  }
  const refreshed = await store.refresh({ force: true, rootId: selectedRootId.value });
  if (refreshed) lastOverviewRefreshAt = Date.now();
  await loadPerformance();
}

function refreshAfterVisibilityChange(): void {
  if (document.visibilityState === "hidden") return;
  void refreshRuntimeState();
  void loadPerformance();
  if (Date.now() - lastOverviewRefreshAt > FOCUS_REFRESH_STALE_MS) {
    void refreshExternalProjectState();
  }
}

async function loadPerformance(): Promise<void> {
  if (document.visibilityState === "hidden" || !selectedRootId.value) return;
  try {
    performance.value = await getPerformance({ rootId: selectedRootId.value });
  } catch {
    // Performance metrics are diagnostic only; project operations should not fail because of them.
  }
}

function ensureSelectedRoot(): void {
  if (roots.value.length === 0) {
    selectedRootId.value = "";
    return;
  }
  if (!roots.value.some((root) => root.id === selectedRootId.value)) {
    selectedRootId.value = roots.value[0]?.id ?? "";
  }
}

function formatMs(value: number): string {
  if (value <= 0) return "0ms";
  if (value < 1000) return `${Math.round(value)}ms`;
  return `${(value / 1000).toFixed(1)}s`;
}

onMounted(async () => {
  await loadRoots();
  await initialRefresh();
  document.addEventListener("click", closeRootMenuOnOutsideClick);
  window.addEventListener("keydown", closeRootMenuOnEscape);
  document.addEventListener("visibilitychange", refreshAfterVisibilityChange);
  runtimeRefreshTimer = window.setInterval(() => void refreshRuntimeState(), RUNTIME_REFRESH_INTERVAL_MS);
  overviewRefreshTimer = window.setInterval(() => void refreshExternalProjectState(), OVERVIEW_REFRESH_INTERVAL_MS);
  performanceRefreshTimer = window.setInterval(() => void loadPerformance(), PERFORMANCE_REFRESH_INTERVAL_MS);
});

onBeforeUnmount(() => {
  if (runtimeRefreshTimer) window.clearInterval(runtimeRefreshTimer);
  if (overviewRefreshTimer) window.clearInterval(overviewRefreshTimer);
  if (performanceRefreshTimer) window.clearInterval(performanceRefreshTimer);
  document.removeEventListener("click", closeRootMenuOnOutsideClick);
  window.removeEventListener("keydown", closeRootMenuOnEscape);
  document.removeEventListener("visibilitychange", refreshAfterVisibilityChange);
});
</script>
