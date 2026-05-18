<template>
  <section class="recovery surface">
    <div class="recovery-copy">
      <p class="eyebrow">{{ preferences.t("recoveryCard") }}</p>
      <h2>{{ project.name }}</h2>
      <p>{{ summary }}</p>
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
import type { Project } from "@local-dev-cockpit/core";
import { usePreferencesStore } from "../../stores/preferences";

const props = defineProps<{ project: Project }>();
const preferences = usePreferencesStore();

const ports = computed(() => {
  const open = props.project.ports
    .filter((port) => port.status === "open" && port.source !== "common")
    .map((port) => port.port);
  return open.length > 0 ? open.join(", ") : preferences.t("none");
});

const summary = computed(() => {
  if (props.project.lastError) return props.project.lastError.message;
  if (props.project.lastRun?.status === "running") return preferences.t("commandRunning");
  const command = props.project.commands.find((item) => item.kind === "dev") ?? props.project.commands[0];
  return command ? preferences.t("suggestedNextStep", { command: command.label }) : preferences.t("noCommandsSummary");
});
</script>
