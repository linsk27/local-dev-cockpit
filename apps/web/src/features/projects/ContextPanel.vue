<template>
  <section class="surface context-panel">
    <div class="surface-heading">
      <span>{{ preferences.t("aiContext") }}</span>
      <button class="text-button" @click="copyContext">
        <Copy :size="14" />
        {{ preferences.t("copy") }}
      </button>
    </div>
    <textarea readonly :value="store.context?.context ?? preferences.t('contextPlaceholder')" @focus="store.loadContext()" />
  </section>
</template>

<script setup lang="ts">
import { Copy } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";

defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();

async function copyContext() {
  await store.loadContext();
  if (store.context) {
    await navigator.clipboard.writeText(store.context.context);
  }
}
</script>
