<template>
  <section class="diagnostics-panel" :class="{ surface: !embedded, embedded }">
    <div v-if="!embedded" class="surface-heading">
      <span>{{ preferences.t("diagnostics") }}</span>
      <Activity :size="16" />
    </div>
    <div class="diagnostics-list">
      <article v-for="item in diagnostics" :key="item.id" class="diagnostic-row" :class="item.tone">
        <span class="diagnostic-dot" />
        <div>
          <span>{{ item.label }}</span>
          <strong :title="item.value">{{ item.value }}</strong>
          <p :title="item.detail">{{ item.detail }}</p>
        </div>
      </article>
      <div v-if="project.commands.length > 0 || showPythonBinding" class="diagnostic-subheading">
        {{ environmentLabels.title }}
      </div>
      <section v-if="showPythonBinding" class="python-environment-card">
        <div class="environment-binding-copy">
          <strong>{{ pythonEnvironmentTitle }}</strong>
          <span>{{ pythonEnvironmentHelp }}</span>
        </div>
        <div v-if="pythonCandidates.length > 0" class="environment-candidates" :aria-label="environmentLabels.detectedCandidates">
          <button
            v-for="candidate in pythonCandidates"
            :key="candidate.id"
            class="candidate-pill"
            :class="{ active: pythonBinding.trim() === candidate.value }"
            type="button"
            :title="candidateTitle(candidate)"
            @click="applyPythonCandidate(candidate)"
          >
            <span>{{ candidateSourceLabel(candidate.source) }}</span>
            <strong>{{ candidateName(candidate) }}</strong>
          </button>
        </div>
        <p v-else class="environment-empty-hint">{{ environmentLabels.noCandidates }}</p>
        <form class="environment-binding" @submit.prevent="savePythonBinding">
          <label>
            <span>{{ environmentLabels.pythonBinding }}</span>
            <input
              v-model="pythonBinding"
              :disabled="settingsLoading || savingSettings"
              :placeholder="environmentLabels.pythonBindingPlaceholder"
              :title="pythonBinding"
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
      </section>
      <article v-if="environmentLoading" class="diagnostic-row normal">
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
          <p :title="environmentError">{{ environmentError }}</p>
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
            <strong :title="item.resolvedCommand || item.summary">{{ environmentStatusLabel(item.status) }}</strong>
            <p :title="environmentDiagnosticText(item)">{{ environmentDiagnosticText(item) }}</p>
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
  getPythonEnvironmentCandidates,
  getProjectSettings,
  updateProjectEnvironment,
  type CommandEnvironmentDiagnostic,
  type PythonEnvironmentCandidate
} from "../../api";
import { useNotificationsStore } from "../../stores/notifications";
import { usePreferencesStore } from "../../stores/preferences";
import { useProjectsStore } from "../../stores/projects";
import { projectDiagnostics } from "./project-view";

const props = withDefaults(defineProps<{ project: Project; embedded?: boolean }>(), {
  embedded: false
});
const projectStore = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const diagnostics = computed(() => projectDiagnostics(props.project, preferences.locale));
const environmentDiagnostics = ref<CommandEnvironmentDiagnostic[]>([]);
const environmentLoading = ref(false);
const environmentError = ref("");
const pythonBinding = ref("");
const pythonCandidates = ref<PythonEnvironmentCandidate[]>([]);
const settingsLoading = ref(false);
const savingSettings = ref(false);
const showPythonBinding = computed(
  () =>
    props.project.kind === "python" ||
    props.project.kind === "mixed" ||
    props.project.markers.some((marker) => pythonEnvironmentMarkers.has(marker)) ||
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
        pythonBindingHelp: "Use this only when the detected options are wrong or missing.",
        chooseDetected: "Choose a detected environment first. If none is correct, paste a conda binding or python.exe path.",
        bindNeeded: "The last failure looks like a Python environment mismatch. Bind the environment that works in your terminal or editor.",
        noCandidates: "No Python environment candidates were found. Paste conda:env-name or a python.exe path manually.",
        detectedCandidates: "Detected",
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
        pythonBindingHelp: "仅在自动候选不正确或缺失时手动填写。",
        chooseDetected: "先选择检测到的环境；如果都不对，再填写 conda:环境名 或 python.exe 路径。",
        bindNeeded: "最近失败像是 Python 环境不一致。请选择终端或编辑器里能跑通的环境。",
        noCandidates: "没有检测到 Python 环境候选。可以手动填写 conda:环境名 或 python.exe 路径。",
        detectedCandidates: "已检测到",
        save: "保存",
        saving: "保存中",
        clear: "清除"
      }
);
const pythonEnvironmentNeedsBinding = computed(() =>
  /缺少 Python 依赖|ModuleNotFoundError|Python 环境|Conda 环境|conda:环境名/i.test(props.project.lastError?.message ?? "")
);
const pythonEnvironmentTitle = computed(() =>
  preferences.locale === "en-US" ? "Python startup environment" : "Python 启动环境"
);
const pythonEnvironmentHelp = computed(() =>
  pythonEnvironmentNeedsBinding.value ? environmentLabels.value.bindNeeded : environmentLabels.value.chooseDetected
);
const pythonEnvironmentMarkers = new Set([
  "requirements.txt",
  "requirements-dev.txt",
  "pyproject.toml",
  "environment.yml",
  "environment.yaml",
  "Pipfile",
  "poetry.lock"
]);

watch(
  () => props.project.id,
  async (projectId) => {
    environmentDiagnostics.value = [];
    environmentError.value = "";
    pythonBinding.value = "";
    pythonCandidates.value = [];
    if (!projectId) return;

    const shouldLoadSettings = showPythonBinding.value;
    const shouldLoadDiagnostics = props.project.commands.length > 0;
    if (!shouldLoadSettings && !shouldLoadDiagnostics) return;

    environmentLoading.value = true;
    settingsLoading.value = shouldLoadSettings;
    try {
      const [settings, diagnostics, candidates] = await Promise.all([
        shouldLoadSettings ? getProjectSettings(projectId) : Promise.resolve({ python: "" }),
        shouldLoadDiagnostics ? getEnvironmentDiagnostics(projectId) : Promise.resolve([]),
        shouldLoadSettings ? getPythonEnvironmentCandidates(projectId) : Promise.resolve([])
      ]);
      pythonBinding.value = settings.python;
      environmentDiagnostics.value = diagnostics;
      pythonCandidates.value = candidates;
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

function environmentDiagnosticText(item: CommandEnvironmentDiagnostic): string {
  return `${item.summary} ${item.detail}`.trim();
}

function applyPythonCandidate(candidate: PythonEnvironmentCandidate): void {
  pythonBinding.value = candidate.value;
}

function candidateSourceLabel(source: PythonEnvironmentCandidate["source"]): string {
  const isEnglish = preferences.locale === "en-US";
  const labels: Record<PythonEnvironmentCandidate["source"], string> = isEnglish
    ? {
        manual: "Manual",
        vscode: "VS Code",
        local: "Project env",
        "conda-file": "environment.yml",
        "conda-list": "Conda",
        terminal: "Terminal"
      }
    : {
        manual: "手动",
        vscode: "VS Code",
        local: "项目环境",
        "conda-file": "environment.yml",
        "conda-list": "Conda",
        terminal: "当前终端"
      };
  return labels[source];
}

function candidateName(candidate: PythonEnvironmentCandidate): string {
  if (candidate.value.toLowerCase().startsWith("conda:")) return candidate.value.slice("conda:".length);
  if (candidate.source === "vscode") return ".vscode";
  if (candidate.source === "conda-file") return candidate.value.replace(/^conda:/i, "");
  const envName = environmentNameFromPath(candidate.value) || environmentNameFromPath(candidate.detail);
  return envName || candidate.label;
}

function candidateTitle(candidate: PythonEnvironmentCandidate): string {
  return `${candidate.label}\n${candidate.value}\n${candidate.detail}`.trim();
}

function environmentNameFromPath(value: string): string {
  const parts = value.replace(/\\/g, "/").split("/").filter(Boolean);
  const pythonIndex = parts.findIndex((part) => /^python(?:\.exe)?$/i.test(part));
  if (pythonIndex > 0) {
    const parent = parts[pythonIndex - 1]?.toLowerCase();
    if ((parent === "scripts" || parent === "bin") && pythonIndex > 1) return parts[pythonIndex - 2] ?? "";
    return parts[pythonIndex - 1] ?? "";
  }
  return parts.at(-1) ?? "";
}

async function savePythonBinding(): Promise<void> {
  if (!props.project.id) return;
  savingSettings.value = true;
  environmentError.value = "";
  try {
    const settings = await updateProjectEnvironment(props.project.id, { python: pythonBinding.value.trim() });
    pythonBinding.value = settings.python;
    environmentDiagnostics.value =
      props.project.commands.length > 0 ? await getEnvironmentDiagnostics(props.project.id) : [];
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
