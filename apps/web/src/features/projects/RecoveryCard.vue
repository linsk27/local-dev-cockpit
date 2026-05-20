<template>
  <section class="project-overview-card surface">
    <div class="project-overview-header">
      <div class="project-title-copy">
        <h2>{{ project.name }}</h2>
        <p class="project-path" :title="project.path">{{ project.path }}</p>
      </div>
      <div class="quick-actions" :aria-label="preferences.t('quickActions')">
        <button class="text-button quick-action" type="button" :title="preferences.t('openFolder')" @click="openFolder">
          <FolderOpen :size="14" />
          <span>{{ preferences.t("openFolder") }}</span>
        </button>
        <button class="text-button quick-action" type="button" :title="preferences.t('openEditor')" @click="openEditor">
          <Code2 :size="14" />
          <span>{{ preferences.t("openEditor") }}</span>
        </button>
        <button class="text-button quick-action" type="button" :title="preferences.t('copyPath')" @click="copyProjectPath">
          <Copy :size="14" />
          <span>{{ preferences.t("copyPath") }}</span>
        </button>
        <button class="text-button quick-action" type="button" :title="preferences.t('copyAiContext')" @click="copyProjectContext">
          <Bot :size="14" />
          <span>{{ preferences.t("copyAiContext") }}</span>
        </button>
      </div>
    </div>

    <div class="project-meta-strip">
      <div class="fact">
        <span>{{ preferences.t("stack") }}</span>
        <strong>{{ project.kind }}</strong>
      </div>
      <div class="fact">
        <span>{{ preferences.t("branch") }}</span>
        <strong>{{ project.git.branch }}</strong>
      </div>
      <div class="fact">
        <span>{{ preferences.t("dirty") }}</span>
        <strong>{{ project.git.dirtyCount }}</strong>
      </div>
      <div class="fact">
        <span>{{ preferences.t("runtimeSource") }}</span>
        <strong>{{ sourceLabel }}</strong>
      </div>
      <div class="fact">
        <span>{{ preferences.t("ports") }}</span>
        <strong>{{ ports }}</strong>
      </div>
    </div>

    <div class="runtime-panel" :class="statusTone">
      <div class="project-status-card" :class="statusTone">
        <span class="project-status-icon">
          <Activity :size="15" />
        </span>
        <div>
          <strong>{{ sourceLabel }}</strong>
          <p>{{ summary }}</p>
        </div>
      </div>

      <div class="port-overview">
        <div class="port-group">
          <span>{{ preferences.t("runningEndpoints") }}</span>
          <template v-if="runningPorts.length > 0">
            <span
              v-for="port in runningPorts"
              :key="`${port.host ?? 'host'}:${port.port}`"
              class="port-action"
            >
              <a
                class="port-pill active"
                :href="formatPortUrl(port)"
                target="_blank"
                rel="noreferrer"
              >
                {{ formatPortEndpoint(port) }}
              </a>
              <button
                class="port-stop-button"
                type="button"
                :disabled="isStoppingPort(port.port)"
                :title="`停止端口 ${port.port}`"
                @click="stopPort(port.port)"
              >
                <Loader2 v-if="isStoppingPort(port.port)" :size="12" class="spin-icon" />
                <Square v-else :size="12" />
                <span>{{ isStoppingPort(port.port) ? "停止中" : "停止" }}</span>
              </button>
            </span>
          </template>
          <strong v-else>{{ preferences.t("noRunningEndpoint") }}</strong>
        </div>
        <div v-if="detectedPorts.length > 0" class="port-group">
          <span>{{ preferences.t("detectedPorts") }}</span>
          <span v-for="port in detectedPorts" :key="port.port" class="port-pill">{{ formatPortEndpoint(port) }}</span>
        </div>
        <div v-if="stalePorts.length > 0" class="port-group">
          <span>{{ preferences.t("stalePorts") }}</span>
          <span
            v-for="port in stalePorts"
            :key="`${port.host ?? 'host'}:${port.port}`"
            class="port-action"
          >
            <span class="port-pill stale">{{ formatPortEndpoint(port) }}</span>
            <button
              class="port-stop-button"
              type="button"
              :disabled="isStoppingPort(port.port)"
              :title="`停止残留端口 ${port.port}`"
              @click="stopPort(port.port)"
            >
              <Loader2 v-if="isStoppingPort(port.port)" :size="12" class="spin-icon" />
              <Square v-else :size="12" />
              <span>{{ isStoppingPort(port.port) ? "停止中" : "清理" }}</span>
            </button>
          </span>
        </div>
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
  projectHasAlreadyRunningConflict,
  projectHasFailed,
  projectHasStalePorts,
  projectRuntimeMode,
  runtimeSourceLabel,
  staleProjectPorts,
  visibleProjectPorts
} from "./project-view";

const props = defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();

const ports = computed(() => {
  const open = visibleProjectPorts(props.project).map((port) => formatPortEndpoint(port));
  return open.length > 0 ? open.join(", ") : preferences.t("none");
});

const runningPorts = computed(() => visibleProjectPorts(props.project));
const sourceLabel = computed(() => runtimeSourceLabel(props.project, preferences.locale));
const stalePorts = computed(() => (runningPorts.value.length === 0 ? staleProjectPorts(props.project) : []));
const detectedPorts = computed(() => {
  const displayed = new Set(runningPorts.value.map((port) => `${port.host ?? ""}:${port.port}`));
  return detectedProjectPorts(props.project).filter((port) => !displayed.has(`${port.host ?? ""}:${port.port}`));
});
const statusTone = computed(() => {
  const mode = projectRuntimeMode(props.project);
  if (mode === "managed-running" || mode === "detected-online") return "good";
  if (mode === "stale") return "warn";
  if (projectHasFailed(props.project) || projectHasStalePorts(props.project)) return "danger";
  return "idle";
});
const summary = computed(() => {
  if (projectHasAlreadyRunningConflict(props.project)) return "服务已在检测到的端口运行；上次启动命令因为端口占用退出。";
  if (props.project.lastRun?.status === "running") return preferences.t("commandRunning");
  if (runningPorts.value.length > 0) return "服务已在检测到的端口运行，可以直接打开运行地址。";
  if (stalePorts.value.length > 0) return "检测到开发进程占用端口，但 HTTP 无法访问。请先清理端口再重新运行。";
  if (props.project.lastError) return props.project.lastError.message;
  if (props.project.lastRun?.status === "failed") return "命令运行失败，请查看日志。";
  if (props.project.commands.length > 0) {
    const manager = props.project.packageManager ? `，${props.project.packageManager} 管理` : "";
    return `${props.project.kind} 项目${manager}，已识别 ${props.project.commands.length} 个命令，当前没有运行中的服务。`;
  }
  return preferences.t("noCommandsSummary");
});

function isStoppingPort(port: number): boolean {
  return store.portAction(props.project.id, port) === "stopping";
}

async function stopPort(port: number): Promise<void> {
  const result = await store.stopPort(port, props.project.id);
  if (result?.stopped) {
    notifications.success(portStopSuccessMessage(port, result.alreadyClosed, result.pids.length));
  } else {
    notifications.error(`停止端口失败：${store.error || port}`);
  }
}

function portStopSuccessMessage(port: number, alreadyClosed?: boolean, pidCount = 0): string {
  if (alreadyClosed && pidCount > 0) return `端口 ${port} 已关闭，旧进程记录已清理`;
  if (alreadyClosed) return `端口 ${port} 已经关闭`;
  return `已停止端口 ${port}`;
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
