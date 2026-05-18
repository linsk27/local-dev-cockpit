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
        <span class="project-port" :class="{ 'port-conflict': hasPortConflict(project) }">
          <span>{{ openPorts(project) }}</span>
          <em v-if="hasPortConflict(project)">{{ preferences.t("portConflict") }}</em>
        </span>
      </div>
    </button>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { PortStatus, Project } from "@local-dev-cockpit/core";
import { usePreferencesStore } from "../../stores/preferences";
import { formatPortEndpoint } from "./ports";

const preferences = usePreferencesStore();

const props = defineProps<{
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
  const open = visiblePorts(project).map((port) => formatPortEndpoint(port));
  return open.length > 0 ? open.join(", ") : preferences.t("idle");
}

const openPortCounts = computed(() => {
  const counts = new Map<number, number>();
  for (const project of props.projects) {
    const uniquePorts = new Set(visiblePorts(project).map((port) => port.port));
    for (const port of uniquePorts) {
      counts.set(port, (counts.get(port) ?? 0) + 1);
    }
  }
  return counts;
});

function hasPortConflict(project: Project): boolean {
  return visiblePorts(project).some((port) => (openPortCounts.value.get(port.port) ?? 0) > 1);
}

function visiblePorts(project: Project): PortStatus[] {
  return project.ports.filter((port) => port.status === "open" && port.source !== "common");
}
</script>
