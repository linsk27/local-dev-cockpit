<template>
  <section class="recovery surface">
    <div class="recovery-copy">
      <p class="eyebrow">{{ preferences.t("recoveryCard") }}</p>
      <h2>{{ project.name }}</h2>
      <p>{{ summary }}</p>
      <div class="port-overview">
        <div class="port-group">
          <span>{{ preferences.t("runningEndpoints") }}</span>
          <template v-if="runningPorts.length > 0">
            <a
              v-for="port in runningPorts"
              :key="`${port.host ?? 'host'}:${port.port}`"
              class="port-pill active"
              :href="formatPortUrl(port)"
              target="_blank"
              rel="noreferrer"
            >
              {{ formatPortEndpoint(port) }}
            </a>
          </template>
          <strong v-else>{{ preferences.t("noRunningEndpoint") }}</strong>
        </div>
        <div v-if="detectedPorts.length > 0" class="port-group">
          <span>{{ preferences.t("detectedPorts") }}</span>
          <span v-for="port in detectedPorts" :key="port.port" class="port-pill">{{ formatPortEndpoint(port) }}</span>
        </div>
      </div>
    </div>
    <div class="recovery-facts">
      <div class="fact">
        <span>{{ preferences.t("stack") }}</span>
        <strong>{{ project.kind }}</strong>
      </div>
      <div class="fact">
        <span>{{ preferences.t("branch") }}</span>
        <strong>{{ project.git.branch }}</strong>
      </div>
      <div class="fact">
        <span>{{ preferences.t("dirty") }}</span>
        <strong>{{ project.git.dirtyCount }}</strong>
      </div>
      <div class="fact">
        <span>{{ preferences.t("ports") }}</span>
        <strong>{{ ports }}</strong>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Project } from "@local-dev-cockpit/core";
import { usePreferencesStore } from "../../stores/preferences";
import {
  detectedProjectPorts,
  formatPortEndpoint,
  formatPortUrl,
  recommendedProjectCommand,
  runningProjectPorts,
  visibleProjectPorts
} from "./project-view";

const props = defineProps<{ project: Project }>();
const preferences = usePreferencesStore();

const ports = computed(() => {
  const open = visibleProjectPorts(props.project).map((port) => formatPortEndpoint(port));
  return open.length > 0 ? open.join(", ") : preferences.t("none");
});

const runningPorts = computed(() => runningProjectPorts(props.project));
const detectedPorts = computed(() => detectedProjectPorts(props.project));
const recommendedCommand = computed(() => recommendedProjectCommand(props.project));

const summary = computed(() => {
  if (props.project.lastError) return props.project.lastError.message;
  if (props.project.lastRun?.status === "running") return preferences.t("commandRunning");
  return recommendedCommand.value
    ? preferences.t("suggestedNextStep", { command: recommendedCommand.value.label })
    : preferences.t("noCommandsSummary");
});
</script>
