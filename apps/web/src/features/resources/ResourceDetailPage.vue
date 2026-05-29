<template>
  <section class="resource-panel resource-detail resource-detail-page">
    <template v-if="item">
      <div class="resource-detail-nav">
        <button class="text-button" type="button" @click="$emit('back')">
          <ChevronLeft :size="15" />
          {{ preferences.t("resourceBackToCards") }}
        </button>
      </div>

      <div class="resource-detail-head">
        <div class="resource-title-block">
          <span>{{ categoryLabel(item) }} · {{ item.confidence }}/100</span>
          <h2 :title="item.title">{{ item.title }}</h2>
          <p :title="item.summary">{{ item.summary }}</p>
        </div>
        <img
          v-if="previewImage(item) && !imageFailed"
          class="resource-detail-image"
          :src="previewImage(item)"
          :alt="item.title"
          loading="lazy"
          @error="imageFailed = true"
        />
        <div v-else-if="previewImage(item)" class="resource-detail-image resource-image-placeholder">
          <span>{{ kindLabel(item.kind, preferences).slice(0, 2) }}</span>
          <strong>{{ item.title }}</strong>
        </div>
        <div class="resource-actions">
          <div class="resource-status-switch" role="group" :aria-label="preferences.t('resourceStatus')">
            <button
              v-for="option in statusOptions"
              :key="option.value"
              type="button"
              :class="{ active: item.status === option.value }"
              @click="$emit('setStatus', option.value)"
            >
              {{ preferences.t(option.labelKey) }}
            </button>
          </div>
          <button class="icon-button" :title="preferences.t('removeRoot')" type="button" @click="$emit('remove')">
            <Trash2 :size="15" />
          </button>
        </div>
      </div>

      <div class="resource-meta-strip">
        <span>{{ kindLabel(item.kind, preferences) }}</span>
        <span :title="categoryLabel(item)">{{ categoryLabel(item) }}</span>
        <span>{{ statusLabel(item.status, preferences) }}</span>
        <span>{{ analysisSourceLabel(item.analysisSource, preferences) }}</span>
      </div>

      <div class="resource-tags">
        <span v-for="tag in visibleTags(item)" :key="tag">#{{ tag }}</span>
      </div>

      <div v-if="resourceFacts(item).length" class="resource-fact-list">
        <span v-for="fact in resourceFacts(item)" :key="fact">{{ fact }}</span>
      </div>

      <a v-if="item.sourceUrl" class="resource-source-link" :href="item.sourceUrl" target="_blank" rel="noreferrer">
        <ExternalLink :size="15" />
        <span>{{ item.sourceUrl }}</span>
      </a>

      <div v-if="item.analysisError" class="resource-analysis-note">
        {{ analysisNoteLabel(item.analysisError) }}
      </div>

      <section class="resource-decision-panel">
        <div class="resource-decision-copy">
          <span>{{ preferences.t("resourceDecisionTitle") }}</span>
          <strong>{{ categoryLabel(item) }}</strong>
          <p>{{ resourceDecisionSummary(item) }}</p>
        </div>
        <div class="resource-decision-score">
          <span>{{ preferences.t("resourceConfidence") }}</span>
          <strong>{{ item.confidence }}/100</strong>
          <small>{{ analysisSourceLabel(item.analysisSource, preferences) }}</small>
        </div>
      </section>

      <div class="resource-decision-grid">
        <section class="resource-decision-card">
          <span>{{ preferences.t("resourceEvidenceTitle") }}</span>
          <ul>
            <li v-for="bullet in resourceHighlightBullets(item)" :key="bullet">{{ bullet }}</li>
          </ul>
        </section>
        <section class="resource-decision-card">
          <span>{{ preferences.t("resourceBestUseTitle") }}</span>
          <ul>
            <li v-for="bullet in resourceUseCaseBullets(item)" :key="bullet">{{ bullet }}</li>
          </ul>
        </section>
        <section class="resource-decision-card">
          <span>{{ preferences.t("resourceRiskTitle") }}</span>
          <ul>
            <li v-for="bullet in resourceReviewBullets(item)" :key="bullet">{{ bullet }}</li>
          </ul>
        </section>
      </div>

      <section v-if="relatedResources.length" class="resource-related-panel">
        <div class="resource-related-head">
          <div>
            <strong>{{ preferences.t("resourceRelatedTitle") }}</strong>
            <span>
              {{
                duplicateRelations.length > 0
                  ? preferences.t("resourceRelatedDuplicate")
                  : preferences.t("resourceRelatedDescription")
              }}
            </span>
          </div>
        </div>
        <div class="resource-related-list">
          <button
            v-for="relation in relatedResources"
            :key="relation.item.id"
            class="resource-related-item"
            :class="{ duplicate: relation.duplicate }"
            type="button"
            @click="$emit('select', relation.item.id)"
          >
            <span class="resource-related-score">{{ relation.score }}</span>
            <span class="resource-related-copy">
              <strong :title="relation.item.title">{{ relation.item.title }}</strong>
              <small :title="categoryLabel(relation.item)">{{ categoryLabel(relation.item) }}</small>
            </span>
            <span class="resource-related-reasons">
              <span v-for="reason in relation.reasons.slice(0, 3)" :key="reason">
                {{ relationReasonLabel(reason, preferences) }}
              </span>
            </span>
          </button>
        </div>
      </section>

      <div class="resource-primary-actions">
        <button class="text-button" type="button" @click="$emit('copyContext')">
          <Copy :size="14" />
          {{ preferences.t("resourceCopyToAi") }}
        </button>
      </div>

      <div class="resource-detail-grid">
        <section v-if="imageGallery.length" class="resource-detail-section resource-gallery-section">
          <strong>{{ preferences.t("resourceImagesTitle") }}</strong>
          <div class="resource-gallery-grid">
            <a v-for="image in imageGallery" :key="image.url" :href="image.url" target="_blank" rel="noreferrer" :title="image.label">
              <img :src="image.url" :alt="image.label" loading="lazy" />
              <span>{{ image.label }}</span>
            </a>
          </div>
        </section>
        <section v-if="insightCards(item).length" class="resource-detail-section resource-insight-cards">
          <strong>{{ preferences.t("resourceEvidenceTitle") }}</strong>
          <div class="resource-insight-grid">
            <div v-for="card in insightCards(item)" :key="card.title" class="resource-insight-card">
              <span>{{ card.title }}</span>
              <p>{{ card.value }}</p>
            </div>
          </div>
        </section>
        <section v-if="metadataLinks(item).length" class="resource-detail-section resource-links-section">
          <strong>{{ preferences.t("resourceLinksTitle") }}</strong>
          <div class="resource-link-list">
            <a v-for="link in metadataLinks(item)" :key="link.url" :href="link.url" target="_blank" rel="noreferrer">
              <ExternalLink :size="14" />
              <span>{{ link.label }}</span>
            </a>
          </div>
        </section>
        <section class="resource-detail-section source-panel">
          <strong>{{ preferences.t("resourceSourceTextTitle") }}</strong>
          <div class="resource-output resource-output-readable">
            <p v-for="(block, index) in sourcePreviewBlocks" :key="index">{{ block }}</p>
          </div>
        </section>
      </div>
    </template>
    <div v-else class="resource-empty detail-empty">
      <strong>{{ preferences.t("resourceSelectTitle") }}</strong>
      <span>{{ preferences.t("resourceSelectDescription") }}</span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ChevronLeft, Copy, ExternalLink, Trash2 } from "lucide-vue-next";
import { computed, ref, watch } from "vue";
import type { RadarItem, ResourceStatus } from "../../api";
import { usePreferencesStore } from "../../stores/preferences";
import type { ResourceRelation } from "./resource-insights";
import {
  analysisNoteLabel,
  analysisSourceLabel,
  categoryLabel,
  insightCards,
  kindLabel,
  metadataLinks,
  previewImage,
  resourceImages,
  resourceDecisionSummary,
  relationReasonLabel,
  resourceFacts,
  resourceHighlightBullets,
  resourceReviewBullets,
  resourceUseCaseBullets,
  statusLabel,
  statusOptions,
  visibleTags
} from "./resource-display";

const props = defineProps<{
  duplicateRelations: ResourceRelation[];
  item?: RadarItem;
  relatedResources: ResourceRelation[];
  sourcePreviewBlocks: string[];
}>();

defineEmits<{
  back: [];
  copyContext: [];
  remove: [];
  select: [itemId: string];
  setStatus: [status: ResourceStatus];
}>();

const preferences = usePreferencesStore();
const imageFailed = ref(false);
const imageGallery = computed(() => {
  if (!props.item) return [];
  const primary = previewImage(props.item);
  return resourceImages(props.item).filter((image) => image.url !== primary).slice(0, 6);
});

watch(
  () => (props.item ? previewImage(props.item) : ""),
  () => {
    imageFailed.value = false;
  }
);
</script>
