<template>
  <section class="workspace">
    <header class="workspace-header">
      <div>
        <p class="eyebrow">{{ preferences.t("projectsEyebrow") }}</p>
        <h1>{{ preferences.t("projectsTitle") }}</h1>
      </div>
      <div class="header-actions">
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
import { Check, ChevronDown, FolderOpen, FolderSearch, RefreshCw, Search } from "lucide-vue-next";
import { getRoots, type RootEntry } from "../../api";
import { useNotificationsStore } from "../../stores/notifications";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";
import ProjectDetail from "./ProjectDetail.vue";
import ProjectList from "./ProjectList.vue";
import { formatDisplayPath, projectBelongsToRoot, projectMatchesQuery, sortProjectsForDashboard } from "./project-view";

const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const searchQuery = ref("");
const selectedRootId = ref("all");
const roots = ref<RootEntry[]>([]);
const rootMenuOpen = ref(false);
const rootFilterRef = ref<HTMLElement | null>(null);

const rootOptions = computed(() => [
  { id: "all", label: preferences.t("allRootsOption") },
  ...roots.value.map((root) => ({ id: root.id, label: formatDisplayPath(root.path) }))
]);

const selectedRootLabel = computed(() => rootOptions.value.find((option) => option.id === selectedRootId.value)?.label ?? preferences.t("allRootsOption"));

const scopedProjects = computed(() => {
  if (selectedRootId.value === "all") return store.projects;
  const root = roots.value.find((item) => item.id === selectedRootId.value);
  if (!root) return store.projects;
  return store.projects.filter((project) => projectBelongsToRoot(project, root.path));
});

const visibleProjects = computed(() => sortProjectsForDashboard(scopedProjects.value).filter((project) => projectMatchesQuery(project, searchQuery.value)));

const hasRunningProject = computed(() => store.projects.some((project) => project.lastRun?.status === "running"));
const hasRuntimeWatch = computed(() => hasRunningProject.value || Object.keys(store.runtimeWatches).length > 0);

const activeProject = computed(() => {
  return visibleProjects.value.find((project) => project.id === store.selectedId) ?? visibleProjects.value[0];
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
    if (selectedRootId.value !== "all" && !roots.value.some((root) => root.id === selectedRootId.value)) {
      selectedRootId.value = "all";
    }
  }
);

let runtimeRefreshTimer: number | undefined;
let overviewRefreshTimer: number | undefined;
const notifiedFailedRunIds = new Set<string>();

async function refreshRuntimeState(): Promise<void> {
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
  if (store.loading || store.refreshing) return;
  await store.refresh({ silent: true });
}

async function refreshProjects(): Promise<void> {
  await loadRoots();
  const refreshed = await store.refresh();
  if (refreshed) {
    notifications.success(preferences.t("projectsRefreshedNotice", { count: scopedProjects.value.length }));
  } else {
    notifications.error(preferences.t("refreshFailedNotice", { message: store.error || preferences.t("refreshProjects") }));
  }
}

async function loadRoots(): Promise<void> {
  try {
    roots.value = await getRoots();
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

onMounted(() => {
  void loadRoots();
  void store.refresh();
  document.addEventListener("click", closeRootMenuOnOutsideClick);
  window.addEventListener("keydown", closeRootMenuOnEscape);
  runtimeRefreshTimer = window.setInterval(() => void refreshRuntimeState(), 2000);
  overviewRefreshTimer = window.setInterval(() => void refreshExternalProjectState(), 6000);
});

onBeforeUnmount(() => {
  if (runtimeRefreshTimer) window.clearInterval(runtimeRefreshTimer);
  if (overviewRefreshTimer) window.clearInterval(overviewRefreshTimer);
  document.removeEventListener("click", closeRootMenuOnOutsideClick);
  window.removeEventListener("keydown", closeRootMenuOnEscape);
});
</script>
