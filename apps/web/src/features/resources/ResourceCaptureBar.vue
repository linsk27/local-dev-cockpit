<template>
  <header class="resource-capture surface">
    <div class="resource-capture-title">
      <h1>{{ preferences.t("resourcesTitle") }}</h1>
      <span>{{ count }}</span>
    </div>
    <form class="resource-capture-form" @submit.prevent="$emit('submit')">
      <div class="resource-url-field">
        <LinkIcon :size="17" />
        <input :value="sourceUrl" :placeholder="preferences.t('resourceCapturePlaceholder')" @input="updateSourceUrl" />
      </div>
      <button class="text-button" type="button" @click="$emit('update:expanded', !expanded)">
        <FileText :size="14" />
        {{ expanded ? preferences.t("resourceCollapseText") : preferences.t("resourceSupplementText") }}
      </button>
      <button class="primary-button" type="submit" :disabled="previewing || !canSubmit">
        <Sparkles :size="15" />
        {{ previewing ? preferences.t("resourceParsing") : preferences.t("resourceParse") }}
      </button>
      <textarea
        v-if="expanded"
        :value="sourceText"
        class="resource-source-input"
        rows="4"
        :placeholder="preferences.t('resourceTextPlaceholder')"
        @input="updateSourceText"
      />
    </form>
  </header>
</template>

<script setup lang="ts">
import { FileText, Link as LinkIcon, Sparkles } from "lucide-vue-next";
import { usePreferencesStore } from "../../stores/preferences";

defineProps<{
  canSubmit: boolean;
  count: number;
  expanded: boolean;
  previewing: boolean;
  sourceText: string;
  sourceUrl: string;
}>();

const emit = defineEmits<{
  submit: [];
  "update:expanded": [value: boolean];
  "update:sourceText": [value: string];
  "update:sourceUrl": [value: string];
}>();

const preferences = usePreferencesStore();

function updateSourceUrl(event: Event): void {
  emit("update:sourceUrl", (event.target as HTMLInputElement).value);
}

function updateSourceText(event: Event): void {
  emit("update:sourceText", (event.target as HTMLTextAreaElement).value);
}
</script>
