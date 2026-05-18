<template>
  <section class="surface log-panel">
    <div class="surface-heading">
      <span>{{ preferences.t("logs") }}</span>
      <button class="text-button" :disabled="!project.lastRun" @click="store.loadLogs()">
        {{ preferences.t("reload") }}
      </button>
    </div>
    <pre>{{ store.logs || placeholder }}</pre>
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

const placeholder = computed(() =>
  props.project.lastRun ? preferences.t("emptyRunLogs") : preferences.t("runCommandPrompt")
);

watch(
  () => [props.project.id, props.project.lastRun?.id],
  () => void store.loadLogs(),
  { immediate: true }
);
</script>
