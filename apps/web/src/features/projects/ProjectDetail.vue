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
        <ProjectDiagnostics :project="project" />
      </div>
      <CommandPanel v-else-if="activeTab === 'commands'" :project="project" />
      <LogPanel v-else-if="activeTab === 'logs'" :project="project" />
      <ContextPanel v-else :project="project" />
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref, type Component } from "vue";
import type { Project } from "@local-dev-cockpit/core";
import { Bot, Info, ScrollText, Terminal } from "lucide-vue-next";
import CommandPanel from "./CommandPanel.vue";
import ContextPanel from "./ContextPanel.vue";
import ProjectDiagnostics from "./ProjectDiagnostics.vue";
import RecoveryCard from "./RecoveryCard.vue";
import LogPanel from "../logs/LogPanel.vue";
import { type MessageKey, usePreferencesStore } from "../../stores/preferences";

defineProps<{ project: Project }>();
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
</script>
