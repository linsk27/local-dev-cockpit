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
        :class="{ running: isRunningCommand(command.id), pending: Boolean(commandAction(command.id)), online: isAlreadyOnlineCommand(command.id) }"
        :disabled="isAnotherCommandRunning(command.id) || Boolean(commandAction(command.id)) || isAlreadyOnlineCommand(command.id)"
        :title="commandTitle(command.id)"
        @click="toggleCommand(command.id)"
      >
        <Loader2 v-if="commandAction(command.id)" :size="15" class="spin-icon" />
        <Square v-else-if="isRunningCommand(command.id)" :size="15" />
        <CircleCheck v-else-if="isAlreadyOnlineCommand(command.id)" :size="15" />
        <Play v-else :size="15" />
        <div>
          <strong>{{ command.label }}</strong>
          <span>{{ command.command }} {{ command.args.join(" ") }}</span>
        </div>
        <em>{{ commandStateLabel(command.id, command.kind) }}</em>
      </button>
      <div v-if="project.commands.length === 0" class="muted-block">{{ preferences.t("noCommands") }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { CircleCheck, Loader2, Play, Square, Terminal } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { useNotificationsStore } from "../../stores/notifications";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";
import { commandWouldReuseOpenPort } from "./project-view";

const props = defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();

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

function commandTitle(commandId: string): string {
  if (commandAction(commandId) === "starting") return preferences.t("starting");
  if (commandAction(commandId) === "stopping") return preferences.t("stopping");
  if (isAlreadyOnlineCommand(commandId)) return "服务已在线，避免重复启动。若要重启，请先停止占用端口的旧进程。";
  return isRunningCommand(commandId) ? preferences.t("stopCommand") : preferences.t("runCommand");
}

function commandStateLabel(commandId: string, fallback: string): string {
  if (commandAction(commandId) === "starting") return preferences.t("starting");
  if (commandAction(commandId) === "stopping") return preferences.t("stopping");
  if (isAlreadyOnlineCommand(commandId)) return "已在线";
  return isRunningCommand(commandId) ? preferences.t("running") : fallback;
}

async function toggleCommand(commandId: string): Promise<void> {
  const command = props.project.commands.find((item) => item.id === commandId);
  const commandLabel = command?.label ?? commandId;
  if (command && commandWouldReuseOpenPort(props.project, command)) {
    notifications.info("服务已在线，已阻止重复启动。");
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
</script>
