<template>
  <section class="workspace">
    <header class="workspace-header">
      <div>
        <p class="eyebrow">PROJECTS</p>
        <h1>Restore your local development state</h1>
      </div>
      <div class="header-actions">
        <button class="icon-button" title="Refresh projects" @click="store.refresh">
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
        <h2>No projects found</h2>
        <p>Add a root directory in Settings or run <code>local-dev-cockpit add-root &lt;dir&gt;</code>.</p>
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { onMounted } from "vue";
import { FolderSearch, RefreshCw } from "lucide-vue-next";
import { useProjectsStore } from "../../stores/projects";
import ProjectDetail from "./ProjectDetail.vue";
import ProjectList from "./ProjectList.vue";

const store = useProjectsStore();
onMounted(() => void store.refresh());
</script>

