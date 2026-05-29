<template>
  <section class="project-overview-card surface">
    <div class="project-overview-header">
      <div class="project-title-copy">
        <h2>{{ project.name }}</h2>
        <p class="project-path" :title="project.path">{{ project.path }}</p>
      </div>

      <div class="quick-actions" :aria-label="preferences.t('quickActions')">
        <button class="text-button quick-action" type="button" :title="preferences.t('openFolder')" :aria-label="preferences.t('openFolder')" @click="openFolder">
          <FolderOpen :size="14" />
        </button>
        <button class="text-button quick-action" type="button" :title="preferences.t('openEditor')" :aria-label="preferences.t('openEditor')" @click="openEditor">
          <Code2 :size="14" />
        </button>
        <button class="text-button quick-action" type="button" :title="preferences.t('copyPath')" :aria-label="preferences.t('copyPath')" @click="copyProjectPath">
          <Copy :size="14" />
        </button>
        <button class="text-button quick-action" type="button" :title="preferences.t('copyAiContext')" :aria-label="preferences.t('copyAiContext')" @click="copyProjectContext">
          <Bot :size="14" />
        </button>
      </div>
    </div>

    <div class="overview-status-band" :class="[statusTone, { compact: !hasPortDetails }]">
      <div class="project-status-card" :class="statusTone">
        <span class="project-status-icon">
          <Activity :size="15" />
        </span>
        <div>
          <strong>{{ sourceLabel }}</strong>
          <p class="status-summary" :title="summary">{{ summary }}</p>
          <p v-if="failureActionHint" class="failure-action-hint">{{ failureActionHint }}</p>
        </div>
      </div>

      <div v-if="hasPortDetails" class="port-overview">
        <div class="port-group">
          <span>{{ preferences.t("runningEndpoints") }}</span>
          <template v-if="runningPorts.length > 0">
            <span v-for="port in runningPorts" :key="`${port.host ?? 'host'}:${port.port}`" class="port-action">
              <a class="port-pill active" :href="formatPortUrl(port)" target="_blank" rel="noreferrer">
                {{ formatPortEndpoint(port) }}
              </a>
              <button
                v-if="isStoppablePort(port.port)"
                class="port-stop-button"
                type="button"
                :disabled="isStoppingPort(port.port)"
                :title="localText(`\u505c\u6b62\u7aef\u53e3 ${port.port}`, `Stop port ${port.port}`)"
                @click="stopPort(port.port)"
              >
                <Loader2 v-if="isStoppingPort(port.port)" :size="12" class="spin-icon" />
                <Square v-else :size="12" />
                <span>{{ isStoppingPort(port.port) ? localText("\u505c\u6b62\u4e2d", "Stopping") : localText("\u505c\u6b62", "Stop") }}</span>
              </button>
            </span>
          </template>
          <strong v-else>{{ preferences.t("noRunningEndpoint") }}</strong>
        </div>
        <div v-if="detectedPorts.length > 0" class="port-group">
          <span>{{ preferences.t("detectedPorts") }}</span>
          <a v-for="port in detectedPorts" :key="`${port.host ?? 'host'}:${port.port}`" class="port-pill active" :href="formatPortUrl(port)" target="_blank" rel="noreferrer">
            {{ formatPortEndpoint(port) }}
          </a>
        </div>
        <div v-if="stalePorts.length > 0" class="port-group">
          <span>{{ preferences.t("stalePorts") }}</span>
          <span v-for="port in stalePorts" :key="`${port.host ?? 'host'}:${port.port}`" class="port-action">
            <span class="port-pill stale">{{ formatPortEndpoint(port) }}</span>
            <button
              class="port-stop-button"
              type="button"
              :disabled="isStoppingPort(port.port)"
              :title="localText(`\u6e05\u7406\u6b8b\u7559\u7aef\u53e3 ${port.port}`, `Clean stale port ${port.port}`)"
              @click="stopPort(port.port)"
            >
              <Loader2 v-if="isStoppingPort(port.port)" :size="12" class="spin-icon" />
              <Square v-else :size="12" />
              <span>{{ isStoppingPort(port.port) ? localText("\u6e05\u7406\u4e2d", "Cleaning") : localText("\u6e05\u7406", "Clean") }}</span>
            </button>
          </span>
        </div>
      </div>
    </div>

    <div class="project-meta-strip">
      <div class="fact fact-compact">
        <span>{{ preferences.t("stack") }}</span>
        <strong>{{ project.kind }}</strong>
      </div>
      <div class="fact fact-branch" :title="`${preferences.t('branch')} ${project.git.branch}`">
        <span>{{ preferences.t("branch") }}</span>
        <strong>{{ project.git.branch }}</strong>
      </div>
      <div class="fact fact-compact">
        <span>{{ preferences.t("dirty") }}</span>
        <strong>{{ project.git.dirtyCount }}</strong>
      </div>
      <div class="fact fact-ports" :title="`${preferences.t('ports')} ${ports}`">
        <span>{{ preferences.t("ports") }}</span>
        <strong>{{ ports }}</strong>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Activity, Bot, Code2, Copy, FolderOpen, Loader2, Square } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { useNotificationsStore } from "../../stores/notifications";
import { usePreferencesStore } from "../../stores/preferences";
import { useProjectsStore } from "../../stores/projects";
import {
  detectedProjectPorts,
  formatPortEndpoint,
  formatPortUrl,
  projectFailureActionHint,
  projectFailureHeadline,
  projectHasAlreadyRunningConflict,
  projectHasFailed,
  projectHasStalePorts,
  projectRuntimeMode,
  runtimeSourceLabel,
  staleProjectPorts,
  stoppableProjectPorts,
  visibleProjectPorts
} from "./project-view";

const props = defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();

const visiblePorts = computed(() => visibleProjectPorts(props.project));
const runningPorts = computed(() => visiblePorts.value);
const ports = computed(() => {
  const open = visiblePorts.value.map((port) => formatPortEndpoint(port));
  return open.length > 0 ? open.join(", ") : preferences.t("none");
});

const sourceLabel = computed(() => runtimeSourceLabel(props.project, preferences.locale));
const failureActionHint = computed(() => projectFailureActionHint(props.project, preferences.locale));
const stalePorts = computed(() => (visiblePorts.value.length === 0 ? staleProjectPorts(props.project) : []));
const detectedPorts = computed(() => {
  const displayed = new Set(runningPorts.value.map((port) => port.port));
  return detectedProjectPorts(props.project).filter((port) => !displayed.has(port.port));
});
const hasPortDetails = computed(
  () => runningPorts.value.length > 0 || detectedPorts.value.length > 0 || stalePorts.value.length > 0 || props.project.lastRun?.status === "running"
);
const statusTone = computed(() => {
  const mode = projectRuntimeMode(props.project);
  if (mode === "managed-running" || mode === "detected-online") return "good";
  if (mode === "stale") return "warn";
  if (projectHasFailed(props.project) || projectHasStalePorts(props.project)) return "danger";
  return "idle";
});
const summary = computed(() => {
  if (projectHasAlreadyRunningConflict(props.project)) return localText("\u670d\u52a1\u5df2\u5728\u68c0\u6d4b\u5230\u7684\u7aef\u53e3\u8fd0\u884c\uff1b\u4e0a\u6b21\u542f\u52a8\u547d\u4ee4\u56e0\u4e3a\u7aef\u53e3\u5360\u7528\u9000\u51fa\u3002", "The service is already running on a detected port; the last start exited because the port was occupied.");
  if (props.project.lastRun?.status === "running") return preferences.t("commandRunning");
  if (visiblePorts.value.length > 0) return localText("\u670d\u52a1\u5df2\u5728\u68c0\u6d4b\u5230\u7684\u7aef\u53e3\u8fd0\u884c\uff0c\u53ef\u4ee5\u76f4\u63a5\u6253\u5f00\u8fd0\u884c\u5730\u5740\u3002", "The service is running on a detected port. Open the endpoint directly.");
  if (stalePorts.value.length > 0) return localText("\u68c0\u6d4b\u5230\u5f00\u53d1\u8fdb\u7a0b\u5360\u7528\u7aef\u53e3\uff0c\u4f46 HTTP \u65e0\u6cd5\u8bbf\u95ee\u3002\u8bf7\u5148\u6e05\u7406\u7aef\u53e3\u518d\u91cd\u65b0\u8fd0\u884c\u3002", "A development process is holding a port, but HTTP is unreachable. Clean the port before restarting.");
  if (props.project.lastError) return projectFailureHeadline(props.project, preferences.locale);
  if (props.project.lastRun?.status === "failed") return localText("\u547d\u4ee4\u8fd0\u884c\u5931\u8d25\uff0c\u8bf7\u67e5\u770b\u65e5\u5fd7\u3002", "The command failed. Check the logs.");
  if (props.project.commands.length > 0) {
    const manager = props.project.packageManager ? `${props.project.packageManager} \u9879\u76ee\uff0c` : "";
    const englishManager = props.project.packageManager ? `${props.project.packageManager} project, ` : "";
    return localText(`${manager}\u5df2\u8bc6\u522b ${props.project.commands.length} \u4e2a\u547d\u4ee4\uff0c\u5f53\u524d\u6ca1\u6709\u8fd0\u884c\u4e2d\u7684\u670d\u52a1\u3002`, `${englishManager}detected ${props.project.commands.length} commands and no service is running.`);
  }
  return preferences.t("noCommandsSummary");
});
function isStoppingPort(port: number): boolean {
  return store.portAction(props.project.id, port) === "stopping";
}

function isStoppablePort(port: number): boolean {
  return stoppableProjectPorts(props.project).some((item) => item.port === port);
}

async function stopPort(port: number): Promise<void> {
  const result = await store.stopPort(port, props.project.id);
  if (result?.stopped) {
    notifications.success(portStopSuccessMessage(port, result.alreadyClosed, result.pids.length));
  } else {
    notifications.error(localText(`\u7aef\u53e3\u64cd\u4f5c\u5931\u8d25\uff1a${store.error || port}`, `Port action failed: ${store.error || port}`));
  }
}

function portStopSuccessMessage(port: number, alreadyClosed?: boolean, pidCount = 0): string {
  if (alreadyClosed && pidCount > 0) return localText(`\u7aef\u53e3 ${port} \u5df2\u5173\u95ed\uff0c\u65e7\u8fdb\u7a0b\u8bb0\u5f55\u5df2\u6e05\u7406`, `Port ${port} is closed and stale process records were cleared.`);
  if (alreadyClosed) return localText(`\u7aef\u53e3 ${port} \u5df2\u7ecf\u5173\u95ed`, `Port ${port} is already closed.`);
  return localText(`\u5df2\u505c\u6b62\u7aef\u53e3 ${port}`, `Stopped port ${port}`);
}
function localText(zh: string, en = zh): string {
  return preferences.locale === "zh-CN" ? zh : en;
}

async function copyProjectPath(): Promise<void> {
  try {
    await navigator.clipboard.writeText(props.project.path);
    notifications.success(preferences.t("pathCopiedNotice"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifications.error(preferences.t("contextCopyFailedNotice", { message }));
  }
}

async function openFolder(): Promise<void> {
  const opened = await store.openProjectFolder(props.project.id);
  if (opened) {
    notifications.success(preferences.t("openFolderNotice"));
  } else {
    notifications.error(preferences.t("openFolderFailedNotice", { message: store.error || props.project.path }));
  }
}

async function openEditor(): Promise<void> {
  const opened = await store.openProjectEditor(props.project.id);
  if (opened) {
    notifications.success(preferences.t("openEditorNotice"));
  } else {
    notifications.error(preferences.t("openEditorFailedNotice", { message: store.error || props.project.path }));
  }
}

async function copyProjectContext(): Promise<void> {
  try {
    const context = await store.loadContext(props.project.id);
    if (!context) {
      notifications.error(preferences.t("contextCopyFailedNotice", { message: store.error || preferences.t("aiContext") }));
      return;
    }
    await navigator.clipboard.writeText(context.context);
    notifications.success(preferences.t("contextCopiedNotice"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifications.error(preferences.t("contextCopyFailedNotice", { message }));
  }
}
</script>
