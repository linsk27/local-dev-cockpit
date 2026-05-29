<template>
  <section class="resource-preview surface">
    <div class="resource-preview-main">
      <span>{{ preferences.t("resourcePreviewTitle") }}</span>
      <img
        v-if="previewImage(item) && !imageFailed"
        class="resource-preview-image"
        :src="previewImage(item)"
        :alt="item.title"
        loading="lazy"
        @error="imageFailed = true"
      />
      <div v-else-if="previewImage(item)" class="resource-preview-image resource-image-placeholder">
        <span>{{ kindLabel(item.kind, preferences).slice(0, 2) }}</span>
        <strong>{{ item.title }}</strong>
      </div>
      <h2 :title="item.title">{{ item.title }}</h2>
      <p :title="item.summary">{{ item.summary }}</p>
      <div class="resource-preview-meta">
        <span>{{ kindLabel(item.kind, preferences) }}</span>
        <span :title="categoryLabel(item)">{{ categoryLabel(item) }}</span>
        <span>{{ analysisSourceLabel(item.analysisSource, preferences) }}</span>
        <span>{{ item.confidence }}/100</span>
      </div>
      <div v-if="previewEvidence(item).length" class="resource-evidence-list compact">
        <span v-for="evidence in previewEvidence(item)" :key="evidence">{{ evidence }}</span>
      </div>
    </div>
    <div class="resource-preview-side">
      <div class="resource-tags">
        <span v-for="tag in visibleTags(item)" :key="tag">#{{ tag }}</span>
      </div>
      <div v-if="item.analysisError" class="resource-analysis-note">
        {{ analysisNoteLabel(item.analysisError) }}
      </div>
      <div class="resource-preview-actions">
        <button class="text-button" type="button" :disabled="saving" @click="$emit('cancel')">
          {{ preferences.t("resourceCancel") }}
        </button>
        <button class="primary-button" type="button" :disabled="saving" @click="$emit('commit')">
          <Sparkles :size="14" />
          {{ saving ? preferences.t("resourceJoining") : preferences.t("resourceConfirm") }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { Sparkles } from "lucide-vue-next";
import { ref, watch } from "vue";
import type { RadarItem } from "../../api";
import { usePreferencesStore } from "../../stores/preferences";
import { analysisNoteLabel, analysisSourceLabel, categoryLabel, kindLabel, previewEvidence, previewImage, visibleTags } from "./resource-display";

const props = defineProps<{
  item: RadarItem;
  saving: boolean;
}>();

defineEmits<{
  cancel: [];
  commit: [];
}>();

const preferences = usePreferencesStore();
const imageFailed = ref(false);

watch(
  () => previewImage(props.item),
  () => {
    imageFailed.value = false;
  }
);
</script>
