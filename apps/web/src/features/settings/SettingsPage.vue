<template>
  <section class="workspace settings-page">
    <header class="workspace-header">
      <div>
        <p class="eyebrow">{{ preferences.t("settingsEyebrow") }}</p>
        <h1>{{ preferences.t("settingsTitle") }}</h1>
      </div>
    </header>

    <section class="surface settings-panel">
      <div class="surface-heading">
        <span>{{ preferences.t("appearanceTitle") }}</span>
        <Palette :size="16" />
      </div>

      <div class="settings-section">
        <div class="setting-copy">
          <strong>{{ preferences.t("languageTitle") }}</strong>
        </div>
        <div class="segmented-control">
          <button
            v-for="option in localeOptions"
            :key="option.value"
            type="button"
            :class="{ active: option.value === preferences.locale }"
            @click="preferences.setLocale(option.value)"
          >
            {{ preferences.t(option.labelKey) }}
          </button>
        </div>
      </div>

      <div class="settings-section">
        <div class="setting-copy">
          <strong>{{ preferences.t("themeTitle") }}</strong>
        </div>
        <div class="segmented-control">
          <button
            v-for="option in themeOptions"
            :key="option.value"
            type="button"
            :class="{ active: option.value === preferences.themeMode }"
            @click="preferences.setThemeMode(option.value)"
          >
            {{ preferences.t(option.labelKey) }}
          </button>
        </div>
      </div>

      <div class="settings-section">
        <div class="setting-copy">
          <strong>{{ preferences.t("accentTitle") }}</strong>
        </div>
        <div class="swatch-row">
          <button
            v-for="option in accentOptions"
            :key="option.value"
            type="button"
            class="color-swatch"
            :class="[`swatch-${option.value}`, { active: option.value === preferences.accentColor }]"
            :title="preferences.t(option.labelKey)"
            @click="preferences.setAccentColor(option.value)"
          >
            <Check v-if="option.value === preferences.accentColor" :size="15" />
          </button>
        </div>
      </div>
    </section>

    <section class="surface settings-panel">
      <div class="surface-heading">
        <span>{{ preferences.t("editorTitle") }}</span>
        <Code2 :size="16" />
      </div>

      <div class="root-form">
        <label>
          {{ preferences.t("editorCommand") }}
          <input v-model="editorCommand" :placeholder="preferences.t('editorCommandPlaceholder')" />
        </label>
        <button class="primary-button" @click="saveEditorCommand">
          <Save :size="16" />
          {{ preferences.t("saveEditorCommand") }}
        </button>
      </div>
    </section>

    <section class="surface settings-panel">
      <div class="surface-heading">
        <span>{{ preferences.t("rootsTitle") }}</span>
        <FolderPlus :size="16" />
      </div>

      <div class="root-list" :aria-label="preferences.t('configuredRootsTitle')">
        <div v-if="roots.length === 0" class="muted-block">{{ preferences.t("noRootsConfigured") }}</div>
        <div v-for="root in roots" :key="root.id" class="root-row">
          <span>{{ root.path }}</span>
          <button class="icon-button" :title="preferences.t('removeRoot')" @click="deleteRoot(root.id)">
            <Trash2 :size="16" />
          </button>
        </div>
      </div>

      <div class="root-form">
        <label>
          {{ preferences.t("rootPath") }}
          <input v-model="rootPath" :placeholder="preferences.t('rootPlaceholder')" />
        </label>
        <button class="primary-button" @click="submitRoot">
          <Plus :size="16" />
          {{ preferences.t("addRoot") }}
        </button>
      </div>
      <p v-if="message" class="settings-message">{{ message }}</p>
    </section>
  </section>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { Check, Code2, FolderPlus, Palette, Plus, Save, Trash2 } from "lucide-vue-next";
import { addRoot, getConfig, getRoots, removeRoot, updateConfig, type RootEntry } from "../../api";
import { useNotificationsStore } from "../../stores/notifications";
import { accentOptions, localeOptions, themeOptions, usePreferencesStore } from "../../stores/preferences";

const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const editorCommand = ref("code");
const rootPath = ref("");
const message = ref("");
const roots = ref<RootEntry[]>([]);

onMounted(() => {
  void loadRoots();
  void loadConfig();
});

async function loadConfig(): Promise<void> {
  try {
    const config = await getConfig();
    editorCommand.value = config.editorCommand;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    notifications.error(preferences.t("rootActionFailedNotice", { message: errorMessage }));
  }
}

async function loadRoots(): Promise<void> {
  try {
    roots.value = await getRoots();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    notifications.error(preferences.t("rootActionFailedNotice", { message: errorMessage }));
  }
}

async function submitRoot() {
  if (!rootPath.value.trim()) return;
  try {
    await addRoot(rootPath.value.trim());
    rootPath.value = "";
    message.value = preferences.t("rootSaved");
    await loadRoots();
    notifications.success(preferences.t("rootAddedNotice"));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    notifications.error(preferences.t("rootActionFailedNotice", { message: errorMessage }));
  }
}

async function saveEditorCommand(): Promise<void> {
  if (!editorCommand.value.trim()) return;
  try {
    const config = await updateConfig({ editorCommand: editorCommand.value.trim() });
    editorCommand.value = config.editorCommand;
    notifications.success(preferences.t("editorSavedNotice"));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    notifications.error(preferences.t("rootActionFailedNotice", { message: errorMessage }));
  }
}

async function deleteRoot(rootId: string): Promise<void> {
  try {
    await removeRoot(rootId);
    await loadRoots();
    notifications.success(preferences.t("rootRemovedNotice"));
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    notifications.error(preferences.t("rootActionFailedNotice", { message: errorMessage }));
  }
}
</script>
