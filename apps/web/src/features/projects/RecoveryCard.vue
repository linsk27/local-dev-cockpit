<template>
  <section class="recovery surface">
    <div class="recovery-copy">
      <p class="eyebrow">{{ preferences.t("recoveryCard") }}</p>
      <h2>{{ project.name }}</h2>
      <p>{{ summary }}</p>
      <div class="recovery-actions">
        <a
          v-if="mainEndpoint"
          class="primary-action"
          :href="formatPortUrl(mainEndpoint)"
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink :size="15" />
          {{ preferences.t("openEndpoint") }}
        </a>
        <button v-if="canStop" class="primary-action secondary" :disabled="Boolean(runningAction)" @click="stopRunning">
          <Loader2 v-if="runningAction === 'stopping'" :size="15" class="spin-icon" />
          <Square v-else :size="15" />
          {{ runningAction === "stopping" ? preferences.t("stopping") : preferences.t("stopCommand") }}
        </button>
        <button
          v-else-if="recommendedCommand"
          class="primary-action"
          :disabled="Boolean(recommendedAction)"
          @click="runRecommended"
        >
          <Loader2 v-if="recommendedAction === 'starting'" :size="15" class="spin-icon" />
          <Play v-else :size="15" />
          {{ recommendedLabel }}
        </button>
      </div>
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
import { ExternalLink, Loader2, Play, Square } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";
import {
  detectedProjectPorts,
  formatPortEndpoint,
  formatPortUrl,
  primaryRunningPort,
  recommendedProjectCommand,
  runningProjectPorts,
  visibleProjectPorts
} from "./project-view";

const props = defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();

const ports = computed(() => {
  const open = visibleProjectPorts(props.project).map((port) => formatPortEndpoint(port));
  return open.length > 0 ? open.join(", ") : preferences.t("none");
});

const runningPorts = computed(() => runningProjectPorts(props.project));
const detectedPorts = computed(() => detectedProjectPorts(props.project));
const mainEndpoint = computed(() => primaryRunningPort(props.project));
const recommendedCommand = computed(() => recommendedProjectCommand(props.project));
const canStop = computed(() => props.project.lastRun?.status === "running");
const runningAction = computed(() => {
  const commandId = props.project.lastRun?.commandId;
  return commandId ? store.commandAction(props.project.id, commandId) : undefined;
});
const recommendedAction = computed(() =>
  recommendedCommand.value ? store.commandAction(props.project.id, recommendedCommand.value.id) : undefined
);
const recommendedLabel = computed(() => {
  const command = recommendedCommand.value;
  if (!command) return preferences.t("runCommand");
  const key = props.project.lastError ? "rerunNamedCommand" : "runNamedCommand";
  return preferences.t(key, { command: command.label });
});

const summary = computed(() => {
  if (props.project.lastError) return props.project.lastError.message;
  if (props.project.lastRun?.status === "running") return preferences.t("commandRunning");
  return recommendedCommand.value
    ? preferences.t("suggestedNextStep", { command: recommendedCommand.value.label })
    : preferences.t("noCommandsSummary");
});

async function runRecommended(): Promise<void> {
  if (!recommendedCommand.value) return;
  await store.runCommand(recommendedCommand.value.id, props.project.id);
}

async function stopRunning(): Promise<void> {
  if (!props.project.lastRun) return;
  await store.stop(props.project.lastRun.id, props.project.id);
}
</script>
