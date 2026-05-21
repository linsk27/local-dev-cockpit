<template>
  <section ref="listRef" class="project-list surface">
    <div class="surface-heading">
      <span>{{ preferences.t("projectsHeading") }}</span>
      <strong>{{ countLabel }}</strong>
    </div>
    <div class="project-filter-row" role="list" aria-label="Project filters">
      <button
        v-for="filter in filters"
        :key="filter.id"
        class="project-filter-chip"
        :class="{ active: filter.id === activeFilter }"
        type="button"
        role="listitem"
        @click="$emit('filter', filter.id)"
      >
        <span>{{ preferences.t(filterLabelKeys[filter.id]) }}</span>
        <strong>{{ filter.count }}</strong>
      </button>
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
          <div class="project-row-copy">
            <div class="project-row-titleline">
              <strong>{{ project.name }}</strong>
              <span class="project-state" :class="{ online: projectIsOnline(project), failed: projectHasFailed(project), stale: projectHasStalePorts(project) }">
                {{ statusLabel(project) }}
              </span>
            </div>
            <span class="project-row-path" :title="project.path">{{ formatDisplayPath(project.path) }}</span>
            <div class="project-row-tags">
              <span>{{ project.kind }}</span>
              <span>{{ project.git.branch }}</span>
              <span>{{ project.git.dirtyCount }} {{ preferences.t("dirty") }}</span>
            </div>
          </div>
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
      <span v-else-if="hasPortInformation(project)" class="project-port" :class="{ 'project-port-stale': projectHasStalePorts(project) }">
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
import { computed, ref, watch } from "vue";
import { ExternalLink, Loader2 } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { animateSubtleEntrance, useGsapScope } from "../../shared/animation/useGsap";
import { usePreferencesStore, type MessageKey } from "../../stores/preferences";
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
import type { ProjectListFilter, ProjectListFilterSummary } from "./project-view";

const preferences = usePreferencesStore();
const listRef = ref<HTMLElement | null>(null);

const props = defineProps<{
  projects: Project[];
  totalCount: number;
  selectedId?: string;
  loading?: boolean;
  loadingLabel?: string;
  filters: ProjectListFilterSummary[];
  activeFilter: ProjectListFilter;
}>();

defineEmits<{
  select: [projectId: string];
  filter: [filter: ProjectListFilter];
}>();

const filterLabelKeys: Record<ProjectListFilter, MessageKey> = {
  all: "projectFilterAll",
  online: "projectFilterOnline",
  "standard-runnable": "projectFilterStandard",
  "try-runnable": "projectFilterTry",
  "needs-attention": "projectFilterAttention",
  unidentified: "projectFilterUnidentified"
};

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

function hasPortInformation(project: Project): boolean {
  return project.lastRun?.status === "running" || staleProjectPorts(project).length > 0;
}

const openPortCounts = computed(() => countOpenPortsByNumber(props.projects));

const countLabel = computed(() => {
  return props.projects.length === props.totalCount ? String(props.projects.length) : `${props.projects.length}/${props.totalCount}`;
});

const listAnimation = useGsapScope(listRef, (element, gsap) => {
  animateSubtleEntrance(gsap, element.querySelectorAll(".project-row, .project-row-skeleton"), {
    y: 8,
    duration: 0.24,
    stagger: 0.018
  });
});

watch(
  () => props.projects.map((project) => project.id).join("|"),
  () => {
    void listAnimation.run();
  },
  { flush: "post" }
);

function hasPortConflict(project: Project): boolean {
  return hasProjectPortConflict(project, openPortCounts.value);
}
</script>
