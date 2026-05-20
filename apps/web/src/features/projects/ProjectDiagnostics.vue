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
      <form v-if="showPythonBinding" class="environment-binding" @submit.prevent="savePythonBinding">
        <label>
          <span>{{ environmentLabels.pythonBinding }}</span>
          <input
            v-model="pythonBinding"
            :disabled="settingsLoading || savingSettings"
            :placeholder="environmentLabels.pythonBindingPlaceholder"
          />
          <small>{{ environmentLabels.pythonBindingHelp }}</small>
        </label>
        <button class="text-button" type="submit" :disabled="settingsLoading || savingSettings">
          <Save :size="14" />
          <span>{{ savingSettings ? environmentLabels.saving : environmentLabels.save }}</span>
        </button>
        <button
          v-if="pythonBinding.trim()"
          class="text-button"
          type="button"
          :disabled="settingsLoading || savingSettings"
          @click="clearPythonBinding"
        >
          <RotateCcw :size="14" />
          <span>{{ environmentLabels.clear }}</span>
        </button>
      </form>
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
import { Activity, RotateCcw, Save } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import {
  getEnvironmentDiagnostics,
  getProjectSettings,
  updateProjectEnvironment,
  type CommandEnvironmentDiagnostic
} from "../../api";
import { useNotificationsStore } from "../../stores/notifications";
import { usePreferencesStore } from "../../stores/preferences";
import { useProjectsStore } from "../../stores/projects";
import { projectDiagnostics } from "./project-view";

const props = defineProps<{ project: Project }>();
const projectStore = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const diagnostics = computed(() => projectDiagnostics(props.project, preferences.locale));
const environmentDiagnostics = ref<CommandEnvironmentDiagnostic[]>([]);
const environmentLoading = ref(false);
const environmentError = ref("");
const pythonBinding = ref("");
const settingsLoading = ref(false);
const savingSettings = ref(false);
const showPythonBinding = computed(
  () =>
    props.project.kind === "python" ||
    props.project.kind === "mixed" ||
    props.project.commands.some((command) => ["python", "python3", "py"].includes(command.command.toLowerCase()))
);
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
        missing: "Missing",
        pythonBinding: "Python environment",
        pythonBindingPlaceholder: "conda:env-name or C:\\path\\to\\python.exe",
        pythonBindingHelp:
          "Configure only when auto detection cannot find the right environment, or the desktop app cannot inherit your terminal Conda/venv. Leave empty when .venv, environment.yml, or editor settings already work.",
        save: "Save",
        saving: "Saving",
        clear: "Clear"
      }
    : {
        title: "运行环境",
        checking: "环境检查",
        wait: "检查中",
        checkingDetail: "正在确认本机运行时、项目虚拟环境和 wrapper。",
        unavailable: "检查失败",
        ready: "可运行",
        warn: "需确认",
        missing: "缺失",
        pythonBinding: "Python 环境",
        pythonBindingPlaceholder: "conda:环境名 或 C:\\路径\\python.exe",
        pythonBindingHelp:
          "仅在自动识别不到、桌面版无法继承终端 Conda/venv，或终端能跑但面板缺包时配置；已有 .venv、environment.yml 或编辑器设置时可留空。",
        save: "保存",
        saving: "保存中",
        clear: "清除"
      }
);

watch(
  () => props.project.id,
  async (projectId) => {
    environmentDiagnostics.value = [];
    environmentError.value = "";
    pythonBinding.value = "";
    if (!projectId || props.project.commands.length === 0) return;
    environmentLoading.value = true;
    settingsLoading.value = true;
    try {
      const [settings, diagnostics] = await Promise.all([
        showPythonBinding.value ? getProjectSettings(projectId) : Promise.resolve({ python: "" }),
        getEnvironmentDiagnostics(projectId)
      ]);
      pythonBinding.value = settings.python;
      environmentDiagnostics.value = diagnostics;
    } catch (error) {
      environmentError.value = error instanceof Error ? error.message : String(error);
    } finally {
      environmentLoading.value = false;
      settingsLoading.value = false;
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

async function savePythonBinding(): Promise<void> {
  if (!props.project.id) return;
  savingSettings.value = true;
  environmentError.value = "";
  try {
    const settings = await updateProjectEnvironment(props.project.id, { python: pythonBinding.value.trim() });
    pythonBinding.value = settings.python;
    environmentDiagnostics.value = await getEnvironmentDiagnostics(props.project.id);
    await projectStore.refreshProject(props.project.id);
    notifications.success(preferences.locale === "en-US" ? "Python environment saved." : "Python 环境已保存。");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    environmentError.value = message;
    notifications.error(message);
  } finally {
    savingSettings.value = false;
  }
}

async function clearPythonBinding(): Promise<void> {
  pythonBinding.value = "";
  await savePythonBinding();
}
</script>
