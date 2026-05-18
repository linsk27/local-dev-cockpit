<template>
  <section class="project-detail">
    <RecoveryCard :project="project" />
    <div class="detail-grid">
      <CommandPanel :project="project" />
      <LogPanel :project="project" />
      <ContextPanel :project="project" />
    </div>
  </section>
</template>

<script setup lang="ts">
import type { Project } from "@local-dev-cockpit/core";
import CommandPanel from "./CommandPanel.vue";
import ContextPanel from "./ContextPanel.vue";
import RecoveryCard from "./RecoveryCard.vue";
import LogPanel from "../logs/LogPanel.vue";

defineProps<{ project: Project }>();
</script>

