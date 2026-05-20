<template>
  <section class="surface command-panel">
    <div class="surface-heading">
      <span>{{ preferences.t("commands") }}</span>
      <Terminal :size="16" />
    </div>
    <div class="command-list">
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
import { ref, watch } from "vue";
import { CircleAlert, CircleCheck, Loader2, Play, Square, Terminal } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { getEnvironmentDiagnostics, type CommandEnvironmentDiagnostic } from "../../api";
import { useNotificationsStore } from "../../stores/notifications";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";
import { commandBlockedByStalePort, commandWouldReuseOpenPort } from "./project-view";

const props = defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const environmentDiagnostics = ref<CommandEnvironmentDiagnostic[]>([]);
let diagnosticsRequestId = 0;

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
  const command = props.project.commands.find((item) => item.id === commandId);
  return command ? commandWouldReuseOpenPort(props.project, command) : false;
}

function isBlockedByStalePort(commandId: string): boolean {
  const command = props.project.commands.find((item) => item.id === commandId);
  return command ? commandBlockedByStalePort(props.project, command) : false;
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
  if (hasMissingDiagnostic(commandId)) return label("缺环境", "missing");
  if (hasWarnDiagnostic(commandId)) return label("需确认", "review");
  if (isAlreadyOnlineCommand(commandId)) return label("已在线", "online");
  if (isBlockedByStalePort(commandId)) return label("需清理", "cleanup");
  return isRunningCommand(commandId) ? preferences.t("running") : fallback;
}

async function toggleCommand(commandId: string): Promise<void> {
  const command = props.project.commands.find((item) => item.id === commandId);
  const commandLabel = command?.label ?? commandId;
  const diagnostic = diagnosticFor(commandId);
  if (diagnostic?.status === "missing") {
    notifications.error(`${diagnostic.summary} ${diagnostic.detail}`.trim());
    return;
  }
  if (command && commandWouldReuseOpenPort(props.project, command)) {
    notifications.info(label("服务已经在线，已阻止重复启动。", "Service is already online. Duplicate start blocked."));
    return;
  }
  if (command && commandBlockedByStalePort(props.project, command)) {
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
