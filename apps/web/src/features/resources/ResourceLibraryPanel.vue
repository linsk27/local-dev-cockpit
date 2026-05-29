<template>
  <section class="resource-panel resource-library-panel">
    <div class="resource-library-head">
      <div>
        <strong>{{ preferences.t("resourceLibraryTitle") }}</strong>
        <span>{{ filteredItems.length }} / {{ allItems.length }}</span>
      </div>
      <button class="icon-button" type="button" :disabled="loading" :title="preferences.t('resourceRefresh')" @click="$emit('refresh')">
        <RefreshCw :size="15" :class="{ 'spin-icon': loading }" />
      </button>
    </div>

    <div class="resource-filter-bar">
      <div class="search-box resource-search">
        <Search :size="16" />
        <input :value="query" :placeholder="preferences.t('resourceSearchPlaceholder')" @input="updateQuery" />
      </div>
      <div class="resource-filter-scroll" aria-label="Resource filters">
        <button
          v-for="filter in filters"
          :key="filter.value"
          class="resource-filter-chip"
          :class="{ active: activeFilter === filter.value }"
          type="button"
          @click="$emit('setBaseFilter', filter.value)"
        >
          <span>{{ filter.labelKey ? preferences.t(filter.labelKey) : filter.label }}</span>
          <strong>{{ counts[filter.value] ?? 0 }}</strong>
        </button>
      </div>
      <div v-if="categoryTree.length > 0" class="resource-taxonomy-filter" aria-label="Resource category filters">
        <div class="resource-taxonomy-row">
          <span class="resource-taxonomy-label">{{ preferences.t("resourceMajorCategories") }}</span>
          <button
            v-for="node in categoryTree"
            :key="node.major"
            class="resource-category-chip"
            :class="{ active: activeCategoryMajor === node.major }"
            type="button"
            @click="$emit('setMajorCategory', node.major)"
          >
            <span :title="node.major">{{ node.major }}</span>
            <strong>{{ node.count }}</strong>
          </button>
        </div>
        <div v-if="activeCategoryNode?.children.length" class="resource-taxonomy-row sub-row">
          <span class="resource-taxonomy-label">{{ preferences.t("resourceSubCategories") }}</span>
          <button
            v-for="child in activeCategoryNode.children"
            :key="child.minor"
            class="resource-category-chip"
            :class="{ active: activeFilter === categoryFilterValue(activeCategoryNode.major, child.minor) }"
            type="button"
            @click="$emit('setMinorCategory', activeCategoryNode.major, child.minor)"
          >
            <span :title="child.minor">{{ child.minor }}</span>
            <strong>{{ child.count }}</strong>
          </button>
        </div>
      </div>
    </div>

    <div class="resource-list" role="list">
      <button
        v-for="item in filteredItems"
        :key="item.id"
        class="resource-list-item"
        :class="{ active: selectedId === item.id }"
        type="button"
        role="listitem"
        @click="$emit('select', item.id)"
      >
        <span class="resource-kind-mark" :data-kind="item.kind" />
        <img
          v-if="previewImage(item) && !isImageFailed(item)"
          class="resource-list-thumb"
          :src="previewImage(item)"
          :alt="item.title"
          loading="lazy"
          @error="markImageFailed(item)"
        />
        <span v-else class="resource-list-thumb resource-list-thumb-placeholder">
          {{ imageFallbackLabel(item) }}
        </span>
        <span class="resource-list-copy">
          <strong :title="item.title">{{ item.title }}</strong>
          <small :title="item.sourceUrl ?? item.summary">{{ sourceLabel(item, preferences) }}</small>
          <span class="resource-list-meta">
            <span>{{ kindLabel(item.kind, preferences) }}</span>
            <span :title="categoryLabel(item)">{{ categoryLabel(item) }}</span>
            <span>{{ statusLabel(item.status, preferences) }}</span>
            <span>{{ analysisSourceLabel(item.analysisSource, preferences) }}</span>
          </span>
        </span>
        <span class="resource-list-open" :title="preferences.t('resourceOpenDetail')" aria-hidden="true">
          <span>{{ preferences.t("resourceOpenDetail") }}</span>
          <ChevronRight :size="14" />
        </span>
      </button>
      <div v-if="!loading && filteredItems.length === 0" class="resource-empty" :class="{ 'is-library-empty': allItems.length === 0 }">
        <strong>{{ emptyStateTitle }}</strong>
        <span>{{ emptyStateDescription }}</span>
        <button v-if="allItems.length > 0" class="text-button" type="button" @click="$emit('clearFilters')">
          {{ preferences.t("resourceClearFilters") }}
        </button>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { ChevronRight, RefreshCw, Search } from "lucide-vue-next";
import { ref } from "vue";
import type { RadarItem } from "../../api";
import { usePreferencesStore, type MessageKey } from "../../stores/preferences";
import type { ResourceCategoryNode, ResourceFilter, ResourceFilterCounts } from "./resource-filters";
import { categoryFilterValue } from "./resource-filters";
import { analysisSourceLabel, categoryLabel, kindLabel, previewImage, sourceLabel, statusLabel } from "./resource-display";

defineProps<{
  activeCategoryMajor: string;
  activeCategoryNode?: ResourceCategoryNode;
  activeFilter: ResourceFilter;
  allItems: RadarItem[];
  categoryTree: ResourceCategoryNode[];
  counts: ResourceFilterCounts;
  emptyStateDescription: string;
  emptyStateTitle: string;
  filteredItems: RadarItem[];
  filters: Array<{ value: ResourceFilter; labelKey?: MessageKey; label?: string }>;
  loading: boolean;
  query: string;
  selectedId?: string;
}>();

const emit = defineEmits<{
  clearFilters: [];
  refresh: [];
  select: [itemId: string];
  setBaseFilter: [filter: ResourceFilter];
  setMajorCategory: [category: string];
  setMinorCategory: [category: string, minor: string];
  "update:query": [value: string];
}>();

const preferences = usePreferencesStore();
const failedImages = ref(new Set<string>());

function updateQuery(event: Event): void {
  emit("update:query", (event.target as HTMLInputElement).value);
}

function imageKey(item: RadarItem): string {
  return `${item.id}:${previewImage(item)}`;
}

function isImageFailed(item: RadarItem): boolean {
  return failedImages.value.has(imageKey(item));
}

function markImageFailed(item: RadarItem): void {
  failedImages.value = new Set([...failedImages.value, imageKey(item)]);
}

function imageFallbackLabel(item: RadarItem): string {
  return kindLabel(item.kind, preferences).slice(0, 2);
}
</script>
