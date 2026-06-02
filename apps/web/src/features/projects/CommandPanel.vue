<template>
  <section class="surface command-panel">
    <div class="surface-heading">
      <span>{{ preferences.t("commands") }}</span>
      <Terminal :size="16" />
    </div>
    <div class="command-list">
      <div v-if="commandGuardPorts.length > 0" class="command-port-guard">
        <div class="command-port-guard-copy">
          <strong>{{ label("检测到端口已占用", "Port already in use") }}</strong>
          <span>{{ label("相关启动命令已被保护。先打开现有服务，或停止端口后再运行。", "Related commands are protected. Open the existing service or stop the port before running.") }}</span>
        </div>
        <div class="command-port-guard-actions">
          <span v-for="port in commandGuardPorts" :key="`${port.host ?? 'host'}:${port.port}`" class="command-port-action">
            <a v-if="port.status === 'open'" class="text-button command-port-link" :href="formatPortUrl(port)" target="_blank" rel="noreferrer">
              <ExternalLink :size="13" />
              <span>{{ formatPortEndpoint(port) }}</span>
            </a>
            <button
              v-if="canStopVisiblePort(port.port)"
              class="text-button command-port-stop"
              type="button"
              :disabled="isStoppingPort(port.port)"
              :title="port.status === 'open' ? label(`停止端口 ${port.port}`, `Stop port ${port.port}`) : label(`清理残留端口 ${port.port}`, `Clean stale port ${port.port}`)"
              @click="stopPort(port.port)"
            >
              <Loader2 v-if="isStoppingPort(port.port)" :size="13" class="spin-icon" />
              <Square v-else :size="13" />
              <span>{{ port.status === "open" ? label("停止", "Stop") : label("清理", "Clean") }}</span>
            </button>
          </span>
        </div>
      </div>

      <button
        v-for="command in project.commands"
        :key="command.id"
        class="command-row"
        :class="{
          running: isRunningCommand(command.id),
          pending: Boolean(commandAction(command.id)),
          online: isAlreadyOnlineCommand(command.id) || isBlockedByStalePort(command.id),
          warning: hasWarnDiagnostic(command.id),
          missing: hasMissingDiagnostic(command.id)
        }"
        :disabled="
          isAnotherCommandRunning(command.id) ||
          Boolean(commandAction(command.id)) ||
          isAlreadyOnlineCommand(command.id) ||
          isBlockedByStalePort(command.id) ||
          hasMissingDiagnostic(command.id)
        "
        :title="commandTitle(command.id)"
        @click="toggleCommand(command.id)"
      >
        <Loader2 v-if="commandAction(command.id)" :size="15" class="spin-icon" />
        <Square v-else-if="isRunningCommand(command.id)" :size="15" />
        <CircleCheck v-else-if="isAlreadyOnlineCommand(command.id) || isBlockedByStalePort(command.id)" :size="15" />
        <CircleAlert v-else-if="hasMissingDiagnostic(command.id) || hasWarnDiagnostic(command.id)" :size="15" />
        <Play v-else :size="15" />
        <div class="command-copy">
          <strong>{{ command.label }}</strong>
          <span>{{ command.command }} {{ command.args.join(" ") }}</span>
          <small v-if="commandHint(command.id)" class="command-diagnostic-hint">{{ commandHint(command.id) }}</small>
        </div>
        <em>{{ commandStateLabel(command.id, command.kind) }}</em>
      </button>
      <div v-if="project.commands.length === 0" class="muted-block">{{ preferences.t("noCommands") }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { CircleAlert, CircleCheck, ExternalLink, Loader2, Play, Square, Terminal } from "lucide-vue-next";
import type { Command, PortStatus, Project } from "@local-dev-cockpit/core";
import { getEnvironmentDiagnostics, type CommandEnvironmentDiagnostic } from "../../api";
import { useNotificationsStore } from "../../stores/notifications";
import { usePreferencesStore } from "../../stores/preferences";
import { useProjectsStore } from "../../stores/projects";
import {
  commandBlockedByStalePort,
  commandDeclaredPorts,
  commandWouldReuseOpenPort,
  formatPortEndpoint,
  formatPortUrl,
  staleProjectPorts,
  visibleProjectPorts
} from "./project-view";

const props = defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const environmentDiagnostics = ref<CommandEnvironmentDiagnostic[]>([]);
let diagnosticsRequestId = 0;

const commandGuardPorts = computed(() => {
  const byPort = new Map<number, PortStatus>();
  for (const command of props.project.commands) {
    for (const port of commandTouchedBlockedPorts(command)) {
      if (!byPort.has(port.port)) byPort.set(port.port, port);
    }
  }
  return [...byPort.values()].sort((left, right) => left.port - right.port);
});

watch(
  () => [props.project.id, props.project.commands.map((command) => command.id).join("|")],
  async () => {
    const requestId = ++diagnosticsRequestId;
    environmentDiagnostics.value = [];
    if (props.project.commands.length === 0) return;
    try {
      const diagnostics = await getEnvironmentDiagnostics(props.project.id);
      if (requestId === diagnosticsRequestId) environmentDiagnostics.value = diagnostics;
    } catch {
      if (requestId === diagnosticsRequestId) environmentDiagnostics.value = [];
    }
  },
  { immediate: true }
);

function isRunningCommand(commandId: string): boolean {
  return props.project.lastRun?.status === "running" && props.project.lastRun.commandId === commandId;
}

function isAnotherCommandRunning(commandId: string): boolean {
  return props.project.lastRun?.status === "running" && props.project.lastRun.commandId !== commandId;
}

function commandAction(commandId: string) {
  return store.commandAction(props.project.id, commandId);
}

function isAlreadyOnlineCommand(commandId: string): boolean {
  if (isRunningCommand(commandId)) return false;
  const command = props.project.commands.find((item) => item.id === commandId);
  return command ? commandTouchedBlockedPorts(command).some((port) => port.status === "open") : false;
}

function isBlockedByStalePort(commandId: string): boolean {
  if (isRunningCommand(commandId)) return false;
  const command = props.project.commands.find((item) => item.id === commandId);
  return command ? commandTouchedBlockedPorts(command).some((port) => port.status !== "open") : false;
}

function diagnosticFor(commandId: string): CommandEnvironmentDiagnostic | undefined {
  return environmentDiagnostics.value.find((item) => item.commandId === commandId);
}

function hasMissingDiagnostic(commandId: string): boolean {
  return diagnosticFor(commandId)?.status === "missing";
}

function hasWarnDiagnostic(commandId: string): boolean {
  return diagnosticFor(commandId)?.status === "warn";
}

function commandTitle(commandId: string): string {
  const diagnostic = diagnosticFor(commandId);
  if (diagnostic?.status === "missing" || diagnostic?.status === "warn") {
    return `${diagnostic.summary} ${diagnostic.detail}`.trim();
  }
  if (commandAction(commandId) === "starting") return preferences.t("starting");
  if (commandAction(commandId) === "stopping") return preferences.t("stopping");
  if (isAlreadyOnlineCommand(commandId)) return label("服务已经在线，已避免重复启动。需要重启时请先停止当前端口。", "Service is already online. Stop the current endpoint before restarting.");
  if (isBlockedByStalePort(commandId)) return label("检测到残留端口，已阻止启动。请先在概况页清理端口。", "A stale port is blocking this command. Clean it from the overview first.");
  return isRunningCommand(commandId) ? preferences.t("stopCommand") : preferences.t("runCommand");
}

function commandHint(commandId: string): string {
  const diagnostic = diagnosticFor(commandId);
  if (diagnostic?.status === "missing" || diagnostic?.status === "warn") {
    return `${diagnostic.summary} ${diagnostic.detail}`.trim();
  }
  if (isAlreadyOnlineCommand(commandId)) {
    return label("服务已在线；需要重启时先停止当前端口。", "Service is online; stop it before restarting.");
  }
  if (isBlockedByStalePort(commandId)) {
    return label("残留端口阻塞启动，请先在概况页清理。", "A stale port is blocking startup. Clean it in Overview first.");
  }
  return "";
}

function commandStateLabel(commandId: string, fallback: string): string {
  if (commandAction(commandId) === "starting") return preferences.t("starting");
  if (commandAction(commandId) === "stopping") return preferences.t("stopping");
  if (isRunningCommand(commandId)) return preferences.t("running");
  if (hasMissingDiagnostic(commandId)) return label("缺环境", "missing");
  if (hasWarnDiagnostic(commandId)) return label("需确认", "review");
  if (isAlreadyOnlineCommand(commandId)) return label("已在线", "online");
  if (isBlockedByStalePort(commandId)) return label("需清理", "cleanup");
  return fallback;
}

function commandTouchedBlockedPorts(command: Command): PortStatus[] {
  const visiblePorts = visibleProjectPorts(props.project);
  const stalePorts = staleProjectPorts(props.project);
  const declaredPorts = commandDeclaredPorts(command);
  const isStartupCommand = command.kind === "dev" || command.kind === "start";
  const blocksDeclaredPort = commandWouldReuseOpenPort(props.project, command) || commandBlockedByStalePort(props.project, command);

  if (isStartupCommand && visiblePorts.length > 0) return visiblePorts;
  if (isStartupCommand && stalePorts.length > 0) return stalePorts;
  if (declaredPorts.length > 0) {
    return [...visiblePorts, ...stalePorts].filter((port) => declaredPorts.includes(port.port));
  }

  return blocksDeclaredPort ? stalePorts : [];
}

function isStoppingPort(port: number): boolean {
  return store.portAction(props.project.id, port) === "stopping";
}

function canStopVisiblePort(port: number): boolean {
  if (typeof window === "undefined") return true;
  const currentPort = Number(window.location.port || (window.location.protocol === "https:" ? "443" : "80"));
  return !Number.isFinite(currentPort) || currentPort !== port;
}

async function stopPort(port: number): Promise<void> {
  const result = await store.stopPort(port, props.project.id);
  if (result?.stopped) {
    notifications.success(result.alreadyClosed ? label(`端口 ${port} 已关闭。`, `Port ${port} is already closed.`) : label(`已停止端口 ${port}`, `Stopped port ${port}`));
  } else {
    notifications.error(label(`端口操作失败：${store.error || port}`, `Port action failed: ${store.error || port}`));
  }
}

async function toggleCommand(commandId: string): Promise<void> {
  const command = props.project.commands.find((item) => item.id === commandId);
  const commandLabel = command?.label ?? commandId;
  const diagnostic = diagnosticFor(commandId);
  if (diagnostic?.status === "missing") {
    notifications.error(`${diagnostic.summary} ${diagnostic.detail}`.trim());
    return;
  }
  if (command && commandTouchedBlockedPorts(command).some((port) => port.status === "open")) {
    notifications.info(label("服务已经在线，已阻止重复启动。", "Service is already online. Duplicate start blocked."));
    return;
  }
  if (command && commandTouchedBlockedPorts(command).some((port) => port.status !== "open")) {
    notifications.error(label("检测到残留端口阻塞启动，请先清理端口。", "A stale port is blocking startup. Clean it first."));
    return;
  }
  if (isRunningCommand(commandId) && props.project.lastRun) {
    const stopped = await store.stop(props.project.lastRun.id, props.project.id);
    if (stopped) {
      notifications.success(preferences.t("commandStoppedNotice", { command: commandLabel }));
    } else {
      notifications.error(preferences.t("commandActionFailedNotice", { message: store.error || preferences.t("stopCommand") }));
    }
    return;
  }
  const run = await store.runCommand(commandId, props.project.id);
  if (run?.status === "running") {
    notifications.info(preferences.t("commandStartedNotice", { command: commandLabel }));
  } else if (run) {
    const refreshedProject = store.projects.find((project) => project.id === props.project.id);
    notifications.error(
      preferences.t("commandActionFailedNotice", {
        message: refreshedProject?.lastError?.message ?? `${commandLabel} ${run.status}`
      })
    );
  } else {
    notifications.error(preferences.t("commandActionFailedNotice", { message: store.error || preferences.t("runCommand") }));
  }
}

function label(zhCN: string, enUS: string): string {
  return preferences.locale === "en-US" ? enUS : zhCN;
}
</script>
