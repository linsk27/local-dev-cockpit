<template>
  <section class="surface diagnostics-panel">
    <div class="surface-heading">
      <span>{{ preferences.t("diagnostics") }}</span>
      <Activity :size="16" />
    </div>
    <div class="diagnostics-list">
      <article v-for="item in diagnostics" :key="item.id" class="diagnostic-row" :class="item.tone">
        <span class="diagnostic-dot" />
        <div>
          <span>{{ item.label }}</span>
          <strong>{{ item.value }}</strong>
          <p>{{ item.detail }}</p>
        </div>
      </article>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Activity } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { usePreferencesStore } from "../../stores/preferences";
import { projectDiagnostics } from "./project-view";

const props = defineProps<{ project: Project }>();
const preferences = usePreferencesStore();
const diagnostics = computed(() => projectDiagnostics(props.project, preferences.locale));
</script>
