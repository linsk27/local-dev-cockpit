<template>
  <section class="recovery surface">
    <div class="recovery-copy">
      <p class="eyebrow">RECOVERY CARD</p>
      <h2>{{ project.name }}</h2>
      <p>{{ summary }}</p>
    </div>
    <div class="recovery-facts">
      <div class="fact">
        <span>Stack</span>
        <strong>{{ project.kind }}</strong>
      </div>
      <div class="fact">
        <span>Branch</span>
        <strong>{{ project.git.branch }}</strong>
      </div>
      <div class="fact">
        <span>Dirty</span>
        <strong>{{ project.git.dirtyCount }}</strong>
      </div>
      <div class="fact">
        <span>Ports</span>
        <strong>{{ ports }}</strong>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { Project } from "@local-dev-cockpit/core";

const props = defineProps<{ project: Project }>();

const ports = computed(() => {
  const open = props.project.ports
    .filter((port) => port.status === "open" && port.source !== "common")
    .map((port) => port.port);
  return open.length > 0 ? open.join(", ") : "none";
});

const summary = computed(() => {
  if (props.project.lastError) return props.project.lastError.message;
  if (props.project.lastRun?.status === "running") return "A command is currently running. Logs are streaming below.";
  const command = props.project.commands.find((item) => item.kind === "dev") ?? props.project.commands[0];
  return command ? `Suggested next step: run ${command.label}.` : "No commands detected yet. Add a root or inspect the project manually.";
});
</script>
