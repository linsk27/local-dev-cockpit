<template>
  <section
    class="resource-panel resource-library-panel"
    :class="{ 'compact-list-mode': !usesVirtualList, 'short-list-mode': usesShortListMode, 'virtual-list-mode': usesVirtualList }"
  >
    <aside class="resource-library-sidebar">
      <div class="resource-library-head">
        <div>
          <strong>{{ preferences.t("resourceLibraryTitle") }}</strong>
          <span>{{ filteredItems.length }} / {{ allItems.length }}</span>
        </div>
        <button class="icon-button" type="button" :disabled="loading" :title="preferences.t('resourceRefresh')" @click="$emit('refresh')">
          <RefreshCw :size="15" :class="{ 'spin-icon': loading }" />
        </button>
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
    </aside>

    <div class="resource-list-column">
      <div class="resource-list-toolbar">
        <div class="search-box resource-search">
          <Search :size="16" />
          <input :value="query" :placeholder="preferences.t('resourceSearchPlaceholder')" @input="updateQuery" />
        </div>
        <button v-if="query || activeFilter !== 'all'" class="text-button resource-clear-filter" type="button" @click="$emit('clearFilters')">
          {{ preferences.t("resourceClearFilters") }}
        </button>
      </div>

      <div
        ref="listRef"
        class="resource-list"
        :class="{ 'resource-virtual-list': usesVirtualList, 'resource-natural-list': !usesVirtualList }"
        role="list"
        @scroll="updateVirtualWindow"
      >
        <div
          v-if="usesVirtualList && filteredItems.length > 0"
          class="resource-virtual-spacer"
          :style="{ height: `${virtualTotalHeight}px` }"
        >
          <div class="resource-virtual-window" :style="{ transform: `translateY(${virtualOffsetTop}px)` }">
            <button
              v-for="item in visibleItems"
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
          </div>
        </div>
        <template v-else-if="filteredItems.length > 0">
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
        </template>
        <div v-if="!loading && filteredItems.length === 0" class="resource-empty" :class="{ 'is-library-empty': allItems.length === 0 }">
          <strong>{{ emptyStateTitle }}</strong>
          <span>{{ emptyStateDescription }}</span>
          <button v-if="allItems.length > 0" class="text-button" type="button" @click="$emit('clearFilters')">
            {{ preferences.t("resourceClearFilters") }}
          </button>
        </div>
        <div v-if="!usesVirtualList && filteredItems.length > 0" class="resource-list-footer">
          {{ compactListSummary }}
        </div>
        <div v-if="!usesVirtualList && filteredItems.length > 0" class="resource-list-endcap">
          <div class="resource-endcap-art" aria-hidden="true">
            <span></span>
            <span></span>
            <span></span>
          </div>
          <div class="resource-endcap-copy">
            <strong>{{ listEndTitle }}</strong>
            <span>{{ listEndDescription }}</span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { RefreshCw, Search } from "lucide-vue-next";
import type { RadarItem } from "../../api";
import { usePreferencesStore, type MessageKey } from "../../stores/preferences";
import type { ResourceCategoryNode, ResourceFilter, ResourceFilterCounts } from "./resource-filters";
import { categoryFilterValue } from "./resource-filters";
import { categoryLabel, compactCategoryLabel, kindLabel, sourceLabel, statusLabel } from "./resource-display";
import { calculateVirtualResourceWindow, shouldVirtualizeResourceList } from "./resource-virtual-list";

const props = defineProps<{
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
const listRef = ref<HTMLElement | null>(null);
const scrollTop = ref(0);
const viewportHeight = ref(0);
const rowHeight = 110;
const overscan = 6;
let resizeObserver: ResizeObserver | undefined;

const usesVirtualList = computed(() => shouldVirtualizeResourceList(props.filteredItems.length));
const usesShortListMode = computed(() => !usesVirtualList.value && props.filteredItems.length > 0 && props.filteredItems.length <= 6);
const virtualWindow = computed(() =>
  calculateVirtualResourceWindow({
    total: props.filteredItems.length,
    rowHeight,
    viewportHeight: viewportHeight.value,
    scrollTop: scrollTop.value,
    overscan
  })
);
const virtualTotalHeight = computed(() => virtualWindow.value.totalHeight);
const visibleItems = computed(() => props.filteredItems.slice(virtualWindow.value.startIndex, virtualWindow.value.endIndex));
const virtualOffsetTop = computed(() => virtualWindow.value.offsetTop);
const compactListSummary = computed(() => {
  const total = props.filteredItems.length;
  return preferences.locale === "en-US" ? `Showing all ${total} resources in this filter` : `已显示当前筛选的 ${total} 条资源`;
});
const listEndTitle = computed(() => (preferences.locale === "en-US" ? "No more resources" : "没有更多资源"));
const listEndDescription = computed(() =>
  preferences.locale === "en-US" ? "Change filters or paste another lead to continue." : "切换筛选或粘贴新线索继续收集。"
);

function updateQuery(event: Event): void {
  emit("update:query", (event.target as HTMLInputElement).value);
}

function updateVirtualWindow(): void {
  const element = listRef.value;
  if (!element) return;
  scrollTop.value = element.scrollTop;
  viewportHeight.value = element.clientHeight;
}

watch(
  () => props.filteredItems,
  async () => {
    await nextTick();
    updateVirtualWindow();
    if (listRef.value && scrollTop.value > virtualTotalHeight.value) listRef.value.scrollTop = 0;
  },
  { flush: "post" }
);

onMounted(() => {
  updateVirtualWindow();
  if (listRef.value) {
    resizeObserver = new ResizeObserver(updateVirtualWindow);
    resizeObserver.observe(listRef.value);
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});
</script>
