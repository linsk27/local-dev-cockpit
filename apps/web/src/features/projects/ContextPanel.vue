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
import { useNotificationsStore } from "../../stores/notifications";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";

defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();

async function copyContext() {
  const context = await store.loadContext();
  if (!context) {
    notifications.error(preferences.t("contextCopyFailedNotice", { message: store.error || preferences.t("aiContext") }));
    return;
  }
  try {
    await navigator.clipboard.writeText(context.context);
    notifications.success(preferences.t("contextCopiedNotice"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifications.error(preferences.t("contextCopyFailedNotice", { message }));
  }
}
</script>
