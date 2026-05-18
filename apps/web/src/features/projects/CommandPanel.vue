<template>
  <section class="surface command-panel">
    <div class="surface-heading">
      <span>Commands</span>
      <Terminal :size="16" />
    </div>
    <div class="command-list">
      <button
        v-for="command in project.commands"
        :key="command.id"
        class="command-row"
        @click="store.runCommand(command.id)"
      >
        <Play :size="15" />
        <div>
          <strong>{{ command.label }}</strong>
          <span>{{ command.command }} {{ command.args.join(" ") }}</span>
        </div>
        <em>{{ command.kind }}</em>
      </button>
      <div v-if="project.commands.length === 0" class="muted-block">No commands detected.</div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Play, Terminal } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { useProjectsStore } from "../../stores/projects";

defineProps<{ project: Project }>();
const store = useProjectsStore();
</script>

