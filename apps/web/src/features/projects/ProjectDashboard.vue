<template>
  <section class="workspace">
    <header class="workspace-header">
      <div>
        <p class="eyebrow">{{ preferences.t("projectsEyebrow") }}</p>
        <h1>{{ preferences.t("projectsTitle") }}</h1>
      </div>
      <div class="header-actions">
        <label class="search-box">
          <Search :size="16" />
          <input v-model="searchQuery" :placeholder="preferences.t('projectSearchPlaceholder')" />
        </label>
        <button class="icon-button" :class="{ spinning: store.loading }" :title="preferences.t('refreshProjects')" @click="store.refresh">
          <RefreshCw :size="18" />
        </button>
      </div>
    </header>

    <div v-if="store.error" class="error-banner">{{ store.error }}</div>

    <div class="dashboard-grid">
      <ProjectList
        :projects="visibleProjects"
        :total-count="store.projects.length"
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
import { computed, onMounted, ref, watch } from "vue";
import { FolderSearch, RefreshCw, Search } from "lucide-vue-next";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";
import ProjectDetail from "./ProjectDetail.vue";
import ProjectList from "./ProjectList.vue";
import { projectMatchesQuery, sortProjectsForDashboard } from "./project-view";

const store = useProjectsStore();
const preferences = usePreferencesStore();
const searchQuery = ref("");

const visibleProjects = computed(() =>
  sortProjectsForDashboard(store.projects).filter((project) => projectMatchesQuery(project, searchQuery.value))
);

const activeProject = computed(() => {
  return visibleProjects.value.find((project) => project.id === store.selectedId) ?? visibleProjects.value[0];
});

watch(
  () => activeProject.value?.id,
  (projectId) => {
    if (projectId && projectId !== store.selectedId) store.select(projectId);
  }
);

onMounted(() => void store.refresh());
</script>
