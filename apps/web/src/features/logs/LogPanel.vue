<template>
  <section class="surface log-panel">
    <div class="surface-heading">
      <span>Logs</span>
      <button class="text-button" :disabled="!project.lastRun" @click="store.loadLogs()">Reload</button>
    </div>
    <pre>{{ store.logs || placeholder }}</pre>
  </section>
</template>

<script setup lang="ts">
import { computed, watch } from "vue";
import type { Project } from "@local-dev-cockpit/core";
import { useProjectsStore } from "../../stores/projects";

const props = defineProps<{ project: Project }>();
const store = useProjectsStore();

const placeholder = computed(() =>
  props.project.lastRun ? "Logs are empty for this run." : "Run a command to start collecting logs."
);

watch(
  () => props.project.lastRun?.id,
  () => void store.loadLogs(),
  { immediate: true }
);
</script>

