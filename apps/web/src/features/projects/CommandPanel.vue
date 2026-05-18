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
        :class="{ running: isRunningCommand(command.id), pending: Boolean(commandAction(command.id)) }"
        :disabled="isAnotherCommandRunning(command.id) || Boolean(commandAction(command.id))"
        :title="commandTitle(command.id)"
        @click="toggleCommand(command.id)"
      >
        <Loader2 v-if="commandAction(command.id)" :size="15" class="spin-icon" />
        <Square v-else-if="isRunningCommand(command.id)" :size="15" />
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
import { Loader2, Play, Square, Terminal } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";

const props = defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();

function isRunningCommand(commandId: string): boolean {
  return props.project.lastRun?.status === "running" && props.project.lastRun.commandId === commandId;
}

function isAnotherCommandRunning(commandId: string): boolean {
  return props.project.lastRun?.status === "running" && props.project.lastRun.commandId !== commandId;
}

function commandAction(commandId: string) {
  return store.commandAction(props.project.id, commandId);
}

function commandTitle(commandId: string): string {
  if (commandAction(commandId) === "starting") return preferences.t("starting");
  if (commandAction(commandId) === "stopping") return preferences.t("stopping");
  return isRunningCommand(commandId) ? preferences.t("stopCommand") : preferences.t("runCommand");
}

function commandStateLabel(commandId: string, fallback: string): string {
  if (commandAction(commandId) === "starting") return preferences.t("starting");
  if (commandAction(commandId) === "stopping") return preferences.t("stopping");
  return isRunningCommand(commandId) ? preferences.t("running") : fallback;
}

async function toggleCommand(commandId: string): Promise<void> {
  if (isRunningCommand(commandId) && props.project.lastRun) {
    await store.stop(props.project.lastRun.id, props.project.id);
    return;
  }
  await store.runCommand(commandId);
}
</script>
