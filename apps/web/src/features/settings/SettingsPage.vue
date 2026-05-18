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
        <span>{{ preferences.t("rootsTitle") }}</span>
        <FolderPlus :size="16" />
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
import { ref } from "vue";
import { Check, FolderPlus, Palette, Plus } from "lucide-vue-next";
import { addRoot } from "../../api";
import { accentOptions, localeOptions, themeOptions, usePreferencesStore } from "../../stores/preferences";

const preferences = usePreferencesStore();
const rootPath = ref("");
const message = ref("");

async function submitRoot() {
  if (!rootPath.value.trim()) return;
  await addRoot(rootPath.value.trim());
  message.value = preferences.t("rootSaved");
}
</script>
