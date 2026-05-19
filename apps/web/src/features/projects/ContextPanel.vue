<template>
  <section class="surface context-panel">
    <div class="context-panel-header">
      <div class="context-panel-title">
        <strong>{{ preferences.t("aiContext") }}</strong>
        <span>{{ preferences.t("contextPanelDescription") }}</span>
      </div>
      <div class="context-actions">
        <button class="text-button" :disabled="loading" @click="previewContext">
          <FileText :size="14" />
          {{ store.context ? preferences.t("contextRefresh") : preferences.t("contextPreview") }}
        </button>
        <button class="text-button" :disabled="loading" @click="copyContext">
          <Copy :size="14" />
          {{ preferences.t("copy") }}
        </button>
        <button class="text-button" :disabled="loading" @click="writeContextFiles">
          <Save :size="14" />
          {{ preferences.t("contextWrite") }}
        </button>
      </div>
    </div>
    <div class="context-preview" :class="{ empty: !store.context }">
      <pre v-if="store.context">{{ store.context.context }}</pre>
      <p v-else>{{ preferences.t("contextCompactPlaceholder") }}</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Copy, FileText, Save } from "lucide-vue-next";
import type { Project } from "@local-dev-cockpit/core";
import { useNotificationsStore } from "../../stores/notifications";
import { useProjectsStore } from "../../stores/projects";
import { usePreferencesStore } from "../../stores/preferences";

defineProps<{ project: Project }>();
const store = useProjectsStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const loading = ref(false);

async function previewContext(): Promise<void> {
  loading.value = true;
  try {
    const context = await store.loadContext();
    if (!context) {
      notifications.error(preferences.t("contextCopyFailedNotice", { message: store.error || preferences.t("aiContext") }));
    }
  } finally {
    loading.value = false;
  }
}

async function copyContext(): Promise<void> {
  loading.value = true;
  try {
    const context = await store.loadContext();
    if (!context) {
      notifications.error(preferences.t("contextCopyFailedNotice", { message: store.error || preferences.t("aiContext") }));
      return;
    }
    await navigator.clipboard.writeText(context.context);
    notifications.success(preferences.t("contextCopiedNotice"));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifications.error(preferences.t("contextCopyFailedNotice", { message }));
  } finally {
    loading.value = false;
  }
}

async function writeContextFiles(): Promise<void> {
  loading.value = true;
  try {
    const result = await store.writeContextFiles();
    if (!result) {
      notifications.error(preferences.t("contextWriteFailedNotice", { message: store.error || preferences.t("aiContext") }));
      return;
    }
    notifications.success(preferences.t("contextWrittenNotice", { count: result.files.length }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    notifications.error(preferences.t("contextWriteFailedNotice", { message }));
  } finally {
    loading.value = false;
  }
}
</script>
