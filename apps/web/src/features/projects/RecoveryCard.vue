<template>
  <section class="recovery surface">
    <div class="recovery-copy">
      <p class="eyebrow">{{ preferences.t("recoveryCard") }}</p>
      <h2>{{ project.name }}</h2>
      <p class="project-path" :title="project.path">{{ project.path }}</p>
      <p>{{ summary }}</p>
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
    <div class="recovery-facts">
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
        <span>{{ preferences.t("ports") }}</span>
        <strong>{{ ports }}</strong>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { Loader2, Square } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { useNotificationsStore } from "../../stores/notifications";
import { usePreferencesStore } from "../../stores/preferences";
import { useProjectsStore } from "../../stores/projects";
import {
  detectedProjectPorts,
  formatPortEndpoint,
  formatPortUrl,
  projectHasAlreadyRunningConflict,
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
const stalePorts = computed(() => staleProjectPorts(props.project));
const detectedPorts = computed(() => {
  const displayed = new Set(runningPorts.value.map((port) => `${port.host ?? ""}:${port.port}`));
  return detectedProjectPorts(props.project).filter((port) => !displayed.has(`${port.host ?? ""}:${port.port}`));
});
const summary = computed(() => {
  if (stalePorts.value.length > 0) return "检测到残留开发进程占用端口，但 HTTP 无法访问。请先清理残留端口再重新运行。";
  if (projectHasAlreadyRunningConflict(props.project)) return "服务已在检测到的端口运行；上次启动命令因为端口占用退出。";
  if (props.project.lastError) return props.project.lastError.message;
  if (props.project.lastRun?.status === "failed") return "命令运行失败，请查看日志。";
  if (props.project.lastRun?.status === "running") return preferences.t("commandRunning");
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
  const stopped = await store.stopPort(port, props.project.id);
  if (stopped) {
    notifications.success(`已停止端口 ${port}`);
  } else {
    notifications.error(`停止端口失败：${store.error || port}`);
  }
}
</script>
