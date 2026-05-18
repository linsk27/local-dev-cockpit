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
        :class="{ running: isRunningCommand(command.id) }"
        :disabled="isAnotherCommandRunning(command.id)"
        :title="commandTitle(command.id)"
        @click="toggleCommand(command.id)"
      >
        <Square v-if="isRunningCommand(command.id)" :size="15" />
        <Play v-else :size="15" />
        <div>
          <strong>{{ command.label }}</strong>
          <span>{{ command.command }} {{ command.args.join(" ") }}</span>
        </div>
        <em>{{ isRunningCommand(command.id) ? preferences.t("running") : command.kind }}</em>
      </button>
      <div v-if="project.commands.length === 0" class="muted-block">{{ preferences.t("noCommands") }}</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Play, Square, Terminal } from "lucide-vue-next";
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

function commandTitle(commandId: string): string {
  return isRunningCommand(commandId) ? preferences.t("stopCommand") : preferences.t("runCommand");
}

async function toggleCommand(commandId: string): Promise<void> {
  if (isRunningCommand(commandId) && props.project.lastRun) {
    await store.stop(props.project.lastRun.id, props.project.id);
    return;
  }
  await store.runCommand(commandId);
}
</script>
