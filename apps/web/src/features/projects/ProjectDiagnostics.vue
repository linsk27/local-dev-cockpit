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
      <div v-if="project.commands.length > 0" class="diagnostic-subheading">
        {{ environmentLabels.title }}
      </div>
      <article v-if="project.commands.length > 0 && environmentLoading" class="diagnostic-row normal">
        <span class="diagnostic-dot" />
        <div>
          <span>{{ environmentLabels.checking }}</span>
          <strong>{{ environmentLabels.wait }}</strong>
          <p>{{ environmentLabels.checkingDetail }}</p>
        </div>
      </article>
      <article v-else-if="environmentError" class="diagnostic-row warn">
        <span class="diagnostic-dot" />
        <div>
          <span>{{ environmentLabels.title }}</span>
          <strong>{{ environmentLabels.unavailable }}</strong>
          <p>{{ environmentError }}</p>
        </div>
      </article>
      <template v-else>
        <article
          v-for="item in environmentDiagnostics"
          :key="item.commandId"
          class="diagnostic-row"
          :class="environmentTone(item.status)"
        >
          <span class="diagnostic-dot" />
          <div>
            <span>{{ item.label }}</span>
            <strong>{{ environmentStatusLabel(item.status) }}</strong>
            <p>{{ item.summary }} {{ item.detail }}</p>
          </div>
        </article>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Activity } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { getEnvironmentDiagnostics, type CommandEnvironmentDiagnostic } from "../../api";
import { usePreferencesStore } from "../../stores/preferences";
import { projectDiagnostics } from "./project-view";

const props = defineProps<{ project: Project }>();
const preferences = usePreferencesStore();
const diagnostics = computed(() => projectDiagnostics(props.project, preferences.locale));
const environmentDiagnostics = ref<CommandEnvironmentDiagnostic[]>([]);
const environmentLoading = ref(false);
const environmentError = ref("");
const environmentLabels = computed(() =>
  preferences.locale === "en-US"
    ? {
        title: "Runtime environment",
        checking: "Environment check",
        wait: "Checking",
        checkingDetail: "Dev Cockpit is verifying local runtimes and project environments.",
        unavailable: "Check failed",
        ready: "Ready",
        warn: "Needs review",
        missing: "Missing"
      }
    : {
        title: "运行环境",
        checking: "环境检查",
        wait: "检查中",
        checkingDetail: "正在确认本机运行时、项目虚拟环境和 wrapper。",
        unavailable: "检查失败",
        ready: "可运行",
        warn: "需确认",
        missing: "缺失"
      }
);

watch(
  () => props.project.id,
  async (projectId) => {
    environmentDiagnostics.value = [];
    environmentError.value = "";
    if (!projectId || props.project.commands.length === 0) return;
    environmentLoading.value = true;
    try {
      environmentDiagnostics.value = await getEnvironmentDiagnostics(projectId);
    } catch (error) {
      environmentError.value = error instanceof Error ? error.message : String(error);
    } finally {
      environmentLoading.value = false;
    }
  },
  { immediate: true }
);

function environmentTone(status: CommandEnvironmentDiagnostic["status"]): "good" | "warn" | "danger" {
  if (status === "ready") return "good";
  if (status === "missing") return "danger";
  return "warn";
}

function environmentStatusLabel(status: CommandEnvironmentDiagnostic["status"]): string {
  if (status === "ready") return environmentLabels.value.ready;
  if (status === "missing") return environmentLabels.value.missing;
  return environmentLabels.value.warn;
}
</script>
