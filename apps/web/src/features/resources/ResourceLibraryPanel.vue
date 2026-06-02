<template>
  <section class="resource-panel resource-library-panel">
    <div class="resource-filter-bar">
      <div class="resource-library-head">
        <div>
          <strong>{{ preferences.t("resourceLibraryTitle") }}</strong>
          <span>{{ filteredItems.length }} / {{ allItems.length }}</span>
        </div>
        <button class="icon-button" type="button" :disabled="loading" :title="preferences.t('resourceRefresh')" @click="$emit('refresh')">
          <RefreshCw :size="15" :class="{ 'spin-icon': loading }" />
        </button>
      </div>
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
        <span class="resource-list-type-mark" :data-kind="item.kind" aria-hidden="true">
          {{ kindLabel(item.kind, preferences).slice(0, 1) }}
        </span>
        <span class="resource-list-copy">
          <span class="resource-list-title-row">
            <strong :title="item.title">{{ item.title }}</strong>
          </span>
          <small :title="item.sourceUrl ?? item.summary">{{ sourceLabel(item, preferences) }}</small>
          <span class="resource-list-summary" :title="item.summary">{{ item.summary }}</span>
          <span class="resource-list-meta">
            <span>{{ kindLabel(item.kind, preferences) }}</span>
            <span v-if="compactCategoryLabel(item, preferences)" :title="categoryLabel(item)">
              {{ compactCategoryLabel(item, preferences) }}
            </span>
            <span class="resource-list-status">{{ statusLabel(item.status, preferences) }}</span>
            <span class="resource-list-score">{{ Math.round(item.confidence) }}/100</span>
          </span>
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
import { RefreshCw, Search } from "lucide-vue-next";
import type { RadarItem } from "../../api";
import { usePreferencesStore, type MessageKey } from "../../stores/preferences";
import type { ResourceCategoryNode, ResourceFilter, ResourceFilterCounts } from "./resource-filters";
import { categoryFilterValue } from "./resource-filters";
import { categoryLabel, compactCategoryLabel, kindLabel, sourceLabel, statusLabel } from "./resource-display";

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

function updateQuery(event: Event): void {
  emit("update:query", (event.target as HTMLInputElement).value);
}
</script>
