<template>
  <section class="workspace">
    <header class="workspace-header">
      <div>
        <p class="eyebrow">{{ preferences.t("projectsEyebrow") }}</p>
        <h1>{{ preferences.t("projectsTitle") }}</h1>
      </div>
      <div class="header-actions">
        <label v-if="roots.length > 0" class="root-filter">
          <FolderOpen :size="16" />
          <select v-model="selectedRootId" :title="preferences.t('rootFilterLabel')">
            <option value="all">{{ preferences.t("allRootsOption") }}</option>
            <option v-for="root in roots" :key="root.id" :value="root.id">{{ root.path }}</option>
          </select>
        </label>
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
import { FolderOpen, FolderSearch, RefreshCw, Search } from "lucide-vue-next";
import { getRoots, type RootEntry } from "../../api";
import { useNotificationsStore } from "../../stores/notifications";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";
import ProjectDetail from "./ProjectDetail.vue";
import ProjectList from "./ProjectList.vue";
import { projectBelongsToRoot, projectMatchesQuery, sortProjectsForDashboard } from "./project-view";

const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const searchQuery = ref("");
const selectedRootId = ref("all");
const roots = ref<RootEntry[]>([]);

const scopedProjects = computed(() => {
  if (selectedRootId.value === "all") return store.projects;
  const root = roots.value.find((item) => item.id === selectedRootId.value);
  if (!root) return store.projects;
  return store.projects.filter((project) => projectBelongsToRoot(project, root.path));
});

const visibleProjects = computed(() => sortProjectsForDashboard(scopedProjects.value).filter((project) => projectMatchesQuery(project, searchQuery.value)));

const hasRunningProject = computed(() => store.projects.some((project) => project.lastRun?.status === "running"));

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

let refreshTimer: number | undefined;

async function refreshRuntimeState(): Promise<void> {
  if (!hasRunningProject.value) return;
  await store.refresh({ silent: true });
  if (store.selectedProject?.lastRun?.status === "running") {
    await store.loadLogs();
  }
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

onMounted(() => {
  void loadRoots();
  void store.refresh();
  refreshTimer = window.setInterval(() => void refreshRuntimeState(), 2000);
});

onBeforeUnmount(() => {
  if (refreshTimer) window.clearInterval(refreshTimer);
});
</script>
