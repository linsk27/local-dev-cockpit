<template>
  <section class="project-detail">
    <div class="detail-tabs" role="tablist" aria-label="Project detail panels">
      <button
        v-for="tabItem in detailTabs"
        :key="tabItem.id"
        class="detail-tab"
        :class="{ active: activeTab === tabItem.id }"
        type="button"
        role="tab"
        :aria-selected="activeTab === tabItem.id"
        @click="activeTab = tabItem.id"
      >
        <component :is="tabItem.icon" :size="15" />
        <span>{{ preferences.t(tabItem.labelKey) }}</span>
      </button>
    </div>
    <div class="detail-tab-panel">
      <div v-if="activeTab === 'overview'" class="overview-stack">
        <RecoveryCard :project="project" />
        <details class="diagnostics-disclosure surface" :open="diagnosticsOpen" @toggle="onDiagnosticsToggle">
          <summary class="diagnostics-summary">
            <span>
              <Activity :size="15" />
              {{ preferences.t("diagnostics") }}
            </span>
            <small>{{ diagnosticsSummary }}</small>
            <ChevronDown :size="15" />
          </summary>
          <ProjectDiagnostics v-if="diagnosticsOpen" :project="project" embedded />
        </details>
      </div>
      <CommandPanel v-else-if="activeTab === 'commands'" :project="project" />
      <LogPanel v-else-if="activeTab === 'logs'" :project="project" />
      <ContextPanel v-else :project="project" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch, type Component } from "vue";
import type { Project } from "@local-dev-cockpit/core";
import { Activity, Bot, ChevronDown, Info, ScrollText, Terminal } from "lucide-vue-next";
import CommandPanel from "./CommandPanel.vue";
import ContextPanel from "./ContextPanel.vue";
import ProjectDiagnostics from "./ProjectDiagnostics.vue";
import RecoveryCard from "./RecoveryCard.vue";
import LogPanel from "../logs/LogPanel.vue";
import { type MessageKey, usePreferencesStore } from "../../stores/preferences";
import { projectHasFailed, projectHasStalePorts } from "./project-view";

const props = defineProps<{ project: Project }>();
type DetailTab = "overview" | "commands" | "logs" | "context";
type DetailTabItem = {
  id: DetailTab;
  labelKey: MessageKey;
  icon: Component;
};

const detailTabs: DetailTabItem[] = [
  { id: "overview", labelKey: "projectOverview", icon: Info },
  { id: "commands", labelKey: "commands", icon: Terminal },
  { id: "logs", labelKey: "logs", icon: ScrollText },
  { id: "context", labelKey: "aiContext", icon: Bot }
];
const preferences = usePreferencesStore();
const activeTab = ref<DetailTab>("overview");
const diagnosticsOpen = ref(false);
const shouldOpenDiagnostics = computed(() => projectHasFailed(props.project) || projectHasStalePorts(props.project));
const diagnosticsSummary = computed(() =>
  preferences.locale === "en-US" ? "Environment, ports, and last failure details" : "环境、端口和失败原因"
);

watch(
  () => props.project.id,
  () => {
    diagnosticsOpen.value = shouldOpenDiagnostics.value;
  },
  { immediate: true }
);

watch(shouldOpenDiagnostics, (shouldOpen) => {
  if (shouldOpen) diagnosticsOpen.value = true;
});

function onDiagnosticsToggle(event: Event): void {
  diagnosticsOpen.value = (event.currentTarget as HTMLDetailsElement).open;
}
</script>
