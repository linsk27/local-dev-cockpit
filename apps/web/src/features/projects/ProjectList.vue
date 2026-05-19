<template>
  <section class="project-list surface">
    <div class="surface-heading">
      <span>{{ preferences.t("projectsHeading") }}</span>
      <strong>{{ countLabel }}</strong>
    </div>
    <div v-if="loading" class="project-list-loading">
      <Loader2 :size="17" class="spin-icon" />
      <div>
        <strong>{{ preferences.t("loadingProjects") }}</strong>
        <span>{{ loadingLabel }}</span>
      </div>
    </div>
    <article
      v-for="project in projects"
      :key="project.id"
      class="project-row"
      :class="{ active: project.id === selectedId }"
      :title="projectStatusReason(project, preferences.locale)"
    >
      <button class="project-row-select" @click="$emit('select', project.id)">
        <div class="project-row-main">
          <span class="status-dot" :class="statusClass(project)" />
          <div>
            <strong>{{ project.name }}</strong>
            <span>{{ project.kind }} · {{ project.git.branch }}</span>
            <span class="project-row-path" :title="project.path">{{ formatDisplayPath(project.path) }}</span>
          </div>
        </div>
        <div class="project-row-meta">
          <span class="project-state" :class="{ online: projectIsOnline(project), failed: projectHasFailed(project), stale: projectHasStalePorts(project) }">
            {{ statusLabel(project) }}
          </span>
          <span>{{ project.git.dirtyCount }} {{ preferences.t("dirty") }}</span>
        </div>
      </button>
      <a
        v-if="primaryPort(project)"
        class="project-port project-port-link"
        :class="{ 'port-conflict': hasPortConflict(project) }"
        :href="formatPortUrl(primaryPort(project)!)"
        :title="preferences.t('openEndpoint')"
        @click.stop
      >
        <span>{{ formatPortEndpoint(primaryPort(project)!) }}</span>
        <ExternalLink :size="13" />
        <em v-if="hasPortConflict(project)">{{ preferences.t("portConflict") }}</em>
      </a>
      <span v-else class="project-port">
        <span>{{ openPorts(project) }}</span>
      </span>
    </article>
    <template v-if="loading && projects.length === 0">
      <div v-for="index in 5" :key="index" class="project-row-skeleton">
        <span />
        <div>
          <i />
          <i />
          <i />
        </div>
      </div>
    </template>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { ExternalLink, Loader2 } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { usePreferencesStore } from "../../stores/preferences";
import {
  countOpenPortsByNumber,
  formatDisplayPath,
  formatPortEndpoint,
  formatPortUrl,
  hasPortConflict as hasProjectPortConflict,
  projectHasFailed,
  projectHasStalePorts,
  projectIsOnline,
  projectRuntimeMode,
  projectStatusReason,
  staleProjectPorts,
  visibleProjectPorts
} from "./project-view";

const preferences = usePreferencesStore();

const props = defineProps<{
  projects: Project[];
  totalCount: number;
  selectedId?: string;
  loading?: boolean;
  loadingLabel?: string;
}>();

defineEmits<{
  select: [projectId: string];
}>();

function statusClass(project: Project): string {
  const mode = projectRuntimeMode(project);
  if (mode === "managed-running" || mode === "detected-online") return "running";
  if (mode === "stale") return "stale";
  if (mode === "failed") return "failed";
  return "idle";
}

function statusLabel(project: Project): string {
  const mode = projectRuntimeMode(project);
  if (mode === "managed-running") return preferences.t("projectManagedRunning");
  if (mode === "detected-online") return preferences.t("projectDetectedOnline");
  if (mode === "stale") return preferences.t("projectNeedsCleanup");
  if (mode === "failed") return preferences.t("projectFailed");
  return preferences.t("projectOffline");
}

function openPorts(project: Project): string {
  const open = visibleProjectPorts(project).map((port) => formatPortEndpoint(port));
  if (open.length === 0 && project.lastRun?.status === "running") return preferences.t("detectingEndpoint");
  if (open.length === 0 && staleProjectPorts(project).length > 0) return `残留 ${staleProjectPorts(project).map((port) => port.port).join(", ")}`;
  return open.length > 0 ? open.join(", ") : preferences.t("idle");
}

function primaryPort(project: Project) {
  return visibleProjectPorts(project)[0];
}

const openPortCounts = computed(() => countOpenPortsByNumber(props.projects));

const countLabel = computed(() => {
  return props.projects.length === props.totalCount ? String(props.projects.length) : `${props.projects.length}/${props.totalCount}`;
});

function hasPortConflict(project: Project): boolean {
  return hasProjectPortConflict(project, openPortCounts.value);
}
</script>
