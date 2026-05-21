<template>
  <section ref="workspaceRef" class="workspace">
    <WelcomePilotModal
      v-if="showWelcomeModal"
      v-model:root-path="rootPath"
      :submitting="rootSubmitting"
      :picking-root="rootPicking"
      @dismiss="dismissWelcome"
      @pick-root="pickRootFolder"
      @submit="submitRootFromDashboard"
    />

    <header v-if="roots.length > 0" class="workspace-header compact-workspace-header">
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

    <section v-if="roots.length === 0" class="surface onboarding-panel">
      <div class="onboarding-copy">
        <h2>{{ preferences.t("onboardingTitle") }}</h2>
        <p>{{ preferences.t("onboardingDescription") }}</p>
      </div>

      <div class="onboarding-steps" aria-label="Dev Cockpit onboarding">
        <div class="onboarding-step">
          <FolderPlus :size="18" />
          <strong>{{ preferences.t("onboardingStepScan") }}</strong>
          <span>{{ preferences.t("onboardingStepScanDetail") }}</span>
        </div>
        <div class="onboarding-step">
          <PlayCircle :size="18" />
          <strong>{{ preferences.t("onboardingStepRun") }}</strong>
          <span>{{ preferences.t("onboardingStepRunDetail") }}</span>
        </div>
        <div class="onboarding-step">
          <Bot :size="18" />
          <strong>{{ preferences.t("onboardingStepContext") }}</strong>
          <span>{{ preferences.t("onboardingStepContextDetail") }}</span>
        </div>
      </div>

      <form class="onboarding-root-form" @submit.prevent="submitRootFromDashboard">
        <label>
          {{ preferences.t("rootPath") }}
          <input v-model="rootPath" :placeholder="preferences.t('rootPlaceholder')" />
        </label>
        <button class="text-button" type="button" :disabled="rootPicking || rootSubmitting" @click="pickRootFolder">
          <FolderOpen :size="16" />
          {{ rootPicking ? preferences.t("choosingRootFolder") : preferences.t("chooseRootFolder") }}
        </button>
        <button class="primary-button" type="submit" :disabled="!canSubmitRoot || rootSubmitting">
          <Loader2 v-if="rootSubmitting" :size="16" class="spin-icon" />
          <Plus v-else :size="16" />
          {{ preferences.t("onboardingAddRoot") }}
        </button>
      </form>

      <p class="onboarding-privacy">{{ preferences.t("onboardingPrivacy") }}</p>
      <button v-if="welcomeDismissed" class="text-button onboarding-reopen" type="button" @click="openWelcome">
        {{ preferences.t("welcomeReopen") }}
      </button>
    </section>

    <div v-else class="dashboard-grid">
      <ProjectList
        :projects="visibleProjects"
        :total-count="searchedProjects.length"
        :selected-id="activeProject?.id"
        :loading="store.loading"
        :loading-label="loadingLabel"
        :filters="projectFilterOptions"
        :active-filter="projectFilter"
        @filter="projectFilter = $event"
        @select="store.select"
      />
      <ProjectDetail v-if="activeProject" :project="activeProject" />
      <section v-else-if="store.loading" class="empty-state">
        <RefreshCw :size="34" class="spin-icon" />
        <h2>{{ preferences.t("loadingProjects") }}</h2>
      </section>
      <section v-else-if="searchQuery || projectFilter !== 'all'" class="empty-state">
        <FolderSearch :size="34" />
        <h2>{{ preferences.t("projectSearchEmptyTitle") }}</h2>
        <p>{{ preferences.t("projectSearchEmptyDescription") }}</p>
      </section>
      <section v-else class="empty-state">
        <FolderSearch :size="34" />
        <h2>{{ preferences.t("emptyTitle") }}</h2>
        <p>{{ preferences.t("emptyDescription") }}</p>
        <form class="empty-root-form" @submit.prevent="submitRootFromDashboard">
          <input v-model="rootPath" :aria-label="preferences.t('rootPath')" :placeholder="preferences.t('rootPlaceholder')" />
          <button class="text-button" type="button" :disabled="rootPicking || rootSubmitting" @click="pickRootFolder">
            <FolderOpen :size="16" />
            {{ rootPicking ? preferences.t("choosingRootFolder") : preferences.t("chooseRootFolder") }}
          </button>
          <button class="primary-button" type="submit" :disabled="!canSubmitRoot || rootSubmitting">
            <Loader2 v-if="rootSubmitting" :size="16" class="spin-icon" />
            <Plus v-else :size="16" />
            {{ preferences.t("addAnotherRoot") }}
          </button>
        </form>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { Bot, Check, ChevronDown, FolderOpen, FolderPlus, FolderSearch, Loader2, PlayCircle, Plus, RefreshCw, Search } from "lucide-vue-next";
import { RootFolderPickerUnavailableError, addRoot, chooseRootFolder, getRoots, type RootEntry } from "../../api";
import { useNotificationsStore } from "../../stores/notifications";
import { usePerformanceStore } from "../../stores/performance";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";
import { animateSubtleEntrance, useGsapScope } from "../../shared/animation/useGsap";
import ProjectDetail from "./ProjectDetail.vue";
import ProjectList from "./ProjectList.vue";
import WelcomePilotModal from "./WelcomePilotModal.vue";
import {
  buildProjectListFilters,
  formatDisplayPath,
  projectMatchesListFilter,
  projectMatchesQuery,
  sortProjectsForDashboard,
  type ProjectListFilter
} from "./project-view";

const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const performance = usePerformanceStore();
const workspaceRef = ref<HTMLElement | null>(null);
const searchQuery = ref("");
const projectFilter = ref<ProjectListFilter>("all");
const selectedRootId = ref("");
const roots = ref<RootEntry[]>([]);
const rootMenuOpen = ref(false);
const rootFilterRef = ref<HTMLElement | null>(null);
const rootPath = ref("");
const rootSubmitting = ref(false);
const rootPicking = ref(false);
const WELCOME_DISMISSED_KEY = "dev-cockpit:onboarding-dismissed";
const RUNTIME_REFRESH_INTERVAL_MS = 3_000;
const OVERVIEW_REFRESH_INTERVAL_MS = 30_000;
const PERFORMANCE_REFRESH_INTERVAL_MS = 5_000;
const FOCUS_REFRESH_STALE_MS = 10_000;

const rootOptions = computed(() => roots.value.map((root) => ({ id: root.id, label: formatDisplayPath(root.path) })));

const selectedRootLabel = computed(() => rootOptions.value.find((option) => option.id === selectedRootId.value)?.label ?? preferences.t("selectRootOption"));

const scopedProjects = computed(() => store.projects);

const searchedProjects = computed(() => sortProjectsForDashboard(scopedProjects.value).filter((project) => projectMatchesQuery(project, searchQuery.value)));

const projectFilterOptions = computed(() => buildProjectListFilters(searchedProjects.value));

const visibleProjects = computed(() => searchedProjects.value.filter((project) => projectMatchesListFilter(project, projectFilter.value)));

const hasRunningProject = computed(() => store.projects.some((project) => project.lastRun?.status === "running"));
const hasRuntimeWatch = computed(() => hasRunningProject.value || Object.keys(store.runtimeWatches).length > 0);
const canSubmitRoot = computed(() => rootPath.value.trim().length > 0);
const welcomeDismissed = ref(readWelcomeDismissed());
const showWelcomeModal = computed(() => roots.value.length === 0 && !welcomeDismissed.value);

const activeProject = computed(() => {
  return visibleProjects.value.find((project) => project.id === store.selectedId) ?? visibleProjects.value[0];
});

const loadingLabel = computed(() => `当前目录：${selectedRootLabel.value}`);

const workspaceAnimation = useGsapScope(workspaceRef, (element, gsap) => {
  animateSubtleEntrance(
    gsap,
    element.querySelectorAll(
      ".compact-workspace-header, .onboarding-panel, .project-list, .project-detail, .empty-state"
    ),
    { duration: 0.3, stagger: 0.04 }
  );
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

watch(
  () => `${roots.value.length}:${visibleProjects.value.length}:${Boolean(activeProject.value)}`,
  () => {
    void workspaceAnimation.run();
  },
  { flush: "post" }
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

async function submitRootFromDashboard(): Promise<void> {
  if (!canSubmitRoot.value || rootSubmitting.value) return;
  rootSubmitting.value = true;
  try {
    await addRoot(rootPath.value.trim());
    rootPath.value = "";
    welcomeDismissed.value = true;
    localStorage.setItem(WELCOME_DISMISSED_KEY, "true");
    await loadRoots();
    await initialRefresh();
    notifications.success(preferences.t("rootAddedNotice"));
  } catch (error) {
    notifications.error(preferences.t("rootActionFailedNotice", { message: error instanceof Error ? error.message : String(error) }));
  } finally {
    rootSubmitting.value = false;
  }
}

async function pickRootFolder(): Promise<void> {
  if (rootPicking.value || rootSubmitting.value) return;
  rootPicking.value = true;
  try {
    const result = await chooseRootFolder(rootPath.value);
    if (!result.canceled && result.path) {
      rootPath.value = result.path;
      notifications.success(preferences.t("rootFolderSelectedNotice"));
    }
  } catch (error) {
    const errorMessage =
      error instanceof RootFolderPickerUnavailableError
        ? preferences.t("rootFolderPickerOldServerNotice")
        : error instanceof Error
          ? error.message
          : String(error);
    notifications.error(preferences.t("rootFolderPickerFailedNotice", { message: errorMessage }));
  } finally {
    rootPicking.value = false;
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

function dismissWelcome(): void {
  welcomeDismissed.value = true;
  localStorage.setItem(WELCOME_DISMISSED_KEY, "true");
}

function openWelcome(): void {
  welcomeDismissed.value = false;
  localStorage.removeItem(WELCOME_DISMISSED_KEY);
}

function readWelcomeDismissed(): boolean {
  return localStorage.getItem(WELCOME_DISMISSED_KEY) === "true";
}

function selectRoot(rootId: string): void {
  selectedRootId.value = rootId;
  projectFilter.value = "all";
  performance.setRoot(rootId);
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
  await performance.refresh();
}

function ensureSelectedRoot(): void {
  if (roots.value.length === 0) {
    selectedRootId.value = "";
    performance.setRoot("");
    return;
  }
  if (!roots.value.some((root) => root.id === selectedRootId.value)) {
    selectedRootId.value = roots.value[0]?.id ?? "";
  }
  performance.setRoot(selectedRootId.value);
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
