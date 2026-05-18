<template>
  <section class="project-list surface">
    <div class="surface-heading">
      <span>{{ preferences.t("projectsHeading") }}</span>
      <strong>{{ projects.length }}</strong>
    </div>
    <button
      v-for="project in projects"
      :key="project.id"
      class="project-row"
      :class="{ active: project.id === selectedId }"
      @click="$emit('select', project.id)"
    >
      <div class="project-row-main">
        <span class="status-dot" :class="statusClass(project)" />
        <div>
          <strong>{{ project.name }}</strong>
          <span>{{ project.kind }} · {{ project.git.branch }}</span>
        </div>
      </div>
      <div class="project-row-meta">
        <span>{{ project.git.dirtyCount }} {{ preferences.t("dirty") }}</span>
        <span>{{ openPorts(project) }}</span>
      </div>
    </button>
  </section>
</template>

<script setup lang="ts">
import type { Project } from "@local-dev-cockpit/core";
import { usePreferencesStore } from "../../stores/preferences";

const preferences = usePreferencesStore();

defineProps<{
  projects: Project[];
  selectedId?: string;
}>();

defineEmits<{
  select: [projectId: string];
}>();

function statusClass(project: Project): string {
  if (project.lastRun?.status === "running") return "running";
  if (project.lastError) return "failed";
  if (project.ports.some((port) => port.status === "open" && port.source !== "common")) return "running";
  return "idle";
}

function openPorts(project: Project): string {
  const open = project.ports.filter((port) => port.status === "open" && port.source !== "common").map((port) => port.port);
  return open.length > 0 ? open.join(", ") : preferences.t("idle");
}
</script>
