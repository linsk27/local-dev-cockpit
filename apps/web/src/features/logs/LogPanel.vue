<template>
  <section class="surface log-panel">
    <div class="surface-heading">
      <span>{{ preferences.t("logs") }}</span>
      <button class="text-button" :disabled="!project.lastRun" @click="store.loadLogs(project.lastRun?.id)">
        {{ logActionLabel }}
      </button>
    </div>
    <pre>{{ visibleLogs || placeholder }}</pre>
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import type { Project } from "@local-dev-cockpit/core";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";

const props = defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();

const currentRunId = computed(() => props.project.lastRun?.id ?? "");
const visibleLogs = computed(() => (store.logsRunId === currentRunId.value ? store.logs : ""));

const placeholder = computed(() => {
  if (props.project.lastRun?.status === "running") return preferences.t("emptyRunLogs");
  if (props.project.lastRun) return preferences.t("previousRunLogsPrompt");
  return preferences.t("runCommandPrompt");
});

const logActionLabel = computed(() => {
  return visibleLogs.value ? preferences.t("reload") : preferences.t("viewLogs");
});

watch(
  () => [props.project.id, props.project.lastRun?.id, props.project.lastRun?.status],
  () => {
    const run = props.project.lastRun;
    if (run?.status === "running") {
      void store.loadLogs(run.id);
      return;
    }
    if (store.logsRunId !== run?.id) store.clearLogs();
  },
  { immediate: true }
);
</script>
