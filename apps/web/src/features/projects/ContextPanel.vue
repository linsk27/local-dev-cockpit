<template>
  <section class="surface context-panel">
    <div class="surface-heading">
      <span>AI Context</span>
      <button class="text-button" @click="copyContext">
        <Copy :size="14" />
        Copy
      </button>
    </div>
    <textarea readonly :value="store.context?.context ?? 'Load or copy context for this project.'" @focus="store.loadContext()" />
  </section>
</template>

<script setup lang="ts">
import { Copy } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { useProjectsStore } from "../../stores/projects";

defineProps<{ project: Project }>();
const store = useProjectsStore();

async function copyContext() {
  await store.loadContext();
  if (store.context) {
    await navigator.clipboard.writeText(store.context.context);
  }
}
</script>

