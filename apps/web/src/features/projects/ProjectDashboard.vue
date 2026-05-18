<template>
  <section class="workspace">
    <header class="workspace-header">
      <div>
        <p class="eyebrow">{{ preferences.t("projectsEyebrow") }}</p>
        <h1>{{ preferences.t("projectsTitle") }}</h1>
      </div>
      <div class="header-actions">
        <button class="icon-button" :title="preferences.t('refreshProjects')" @click="store.refresh">
          <RefreshCw :size="18" />
        </button>
      </div>
    </header>

    <div v-if="store.error" class="error-banner">{{ store.error }}</div>

    <div class="dashboard-grid">
      <ProjectList :projects="store.projects" :selected-id="store.selectedProject?.id" @select="store.select" />
      <ProjectDetail v-if="store.selectedProject" :project="store.selectedProject" />
      <section v-else class="empty-state">
        <FolderSearch :size="34" />
        <h2>{{ preferences.t("emptyTitle") }}</h2>
        <p>{{ preferences.t("emptyDescription") }}</p>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { FolderSearch, RefreshCw } from "lucide-vue-next";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";
import ProjectDetail from "./ProjectDetail.vue";
import ProjectList from "./ProjectList.vue";

const store = useProjectsStore();
const preferences = usePreferencesStore();
onMounted(() => void store.refresh());
</script>
