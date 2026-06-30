import { computed, ref, watch, type ComputedRef } from "vue";
import type { RadarItem } from "../../api";
import type { MessageKey } from "../../stores/preferences";
import {
  buildResourceIndex,
  categoryFilterValue,
  countResourceIndex,
  filterResourceIndex,
  getCategoryTreeFromIndex,
  parseCategoryFilter,
  type ResourceFilter
} from "./resource-filters";

const baseFilters: Array<{ value: ResourceFilter; labelKey: MessageKey }> = [
  { value: "all", labelKey: "resourceAll" },
  { value: "inbox", labelKey: "resourceInbox" },
  { value: "useful", labelKey: "resourceUseful" },
  { value: "archived", labelKey: "resourceArchived" }
];

export function useResourceFilters(items: ComputedRef<RadarItem[]>) {
  const query = ref("");
  const debouncedQuery = ref("");
  const activeFilter = ref<ResourceFilter>("all");
  let queryDebounceTimer: ReturnType<typeof setTimeout> | undefined;

  const resourceIndex = computed(() => buildResourceIndex(items.value));
  const filteredEntries = computed(() => filterResourceIndex(resourceIndex.value, { query: debouncedQuery.value, filter: activeFilter.value }));
  const filteredItems = computed(() => filteredEntries.value.map((entry) => entry.item));
  const counts = computed(() => countResourceIndex(resourceIndex.value));
  const filters = computed<Array<{ value: ResourceFilter; labelKey?: MessageKey; label?: string }>>(() => [...baseFilters]);
  const categoryTree = computed(() => getCategoryTreeFromIndex(resourceIndex.value));
  const activeCategoryMajor = computed(() => parseCategoryFilter(activeFilter.value)?.major ?? "");
  const activeCategoryNode = computed(() => categoryTree.value.find((node) => node.major === activeCategoryMajor.value));

  watch(query, (value) => {
    if (queryDebounceTimer) globalThis.clearTimeout(queryDebounceTimer);
    queryDebounceTimer = globalThis.setTimeout(() => {
      debouncedQuery.value = value;
    }, items.value.length > 300 ? 120 : 0);
  });

  function clearFilters(): void {
    query.value = "";
    debouncedQuery.value = "";
    activeFilter.value = "all";
  }

  function setBaseFilter(filter: ResourceFilter): void {
    activeFilter.value = filter;
  }

  function setMajorCategory(category: string): void {
    const next = categoryFilterValue(category);
    activeFilter.value = activeFilter.value === next ? "all" : next;
  }

  function setMinorCategory(category: string, minor: string): void {
    activeFilter.value = categoryFilterValue(category, minor);
  }

  function disposeResourceFilters(): void {
    if (queryDebounceTimer) globalThis.clearTimeout(queryDebounceTimer);
  }

  return {
    activeCategoryMajor,
    activeCategoryNode,
    activeFilter,
    categoryTree,
    clearFilters,
    counts,
    debouncedQuery,
    disposeResourceFilters,
    filteredEntries,
    filteredItems,
    filters,
    query,
    resourceIndex,
    setBaseFilter,
    setMajorCategory,
    setMinorCategory
  };
}
