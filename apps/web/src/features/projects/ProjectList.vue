<template>
  <section class="project-list surface">
    <div class="surface-heading">
      <span>{{ preferences.t("projectsHeading") }}</span>
      <strong>{{ countLabel }}</strong>
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
        <span class="project-state" :class="{ online: projectIsOnline(project), failed: Boolean(project.lastError) }">
          {{ statusLabel(project) }}
        </span>
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
import type { Project } from "@local-dev-cockpit/core";
import { usePreferencesStore } from "../../stores/preferences";
import {
  countOpenPortsByNumber,
  formatPortEndpoint,
  hasPortConflict as hasProjectPortConflict,
  projectIsOnline,
  visibleProjectPorts
} from "./project-view";

const preferences = usePreferencesStore();

const props = defineProps<{
  projects: Project[];
  totalCount: number;
  selectedId?: string;
}>();

defineEmits<{
  select: [projectId: string];
}>();

function statusClass(project: Project): string {
  if (project.lastError) return "failed";
  if (projectIsOnline(project)) return "running";
  return "idle";
}

function statusLabel(project: Project): string {
  if (project.lastError) return preferences.t("projectFailed");
  if (projectIsOnline(project)) return preferences.t("projectOnline");
  return preferences.t("projectOffline");
}

function openPorts(project: Project): string {
  const open = visibleProjectPorts(project).map((port) => formatPortEndpoint(port));
  if (open.length === 0 && project.lastRun?.status === "running") return preferences.t("detectingEndpoint");
  return open.length > 0 ? open.join(", ") : preferences.t("idle");
}

const openPortCounts = computed(() => countOpenPortsByNumber(props.projects));

const countLabel = computed(() => {
  return props.projects.length === props.totalCount ? String(props.projects.length) : `${props.projects.length}/${props.totalCount}`;
});

function hasPortConflict(project: Project): boolean {
  return hasProjectPortConflict(project, openPortCounts.value);
}
</script>
