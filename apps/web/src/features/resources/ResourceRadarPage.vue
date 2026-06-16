<template>
  <section class="resource-page">
    <ResourceCaptureBar
      v-model:expanded="captureExpanded"
      v-model:source-text="sourceText"
      v-model:source-url="sourceUrl"
      :can-submit="canSubmit"
      :count="resources.items.length"
      :import-exporting="resources.importExporting"
      :previewing="resources.previewing"
      @export="exportLibrary"
      @import="openImportPicker"
      @submit="submitResource"
    />
    <input ref="importInput" class="visually-hidden" type="file" accept="application/json,.json" @change="importLibraryFile" />

    <div v-if="resources.error" class="error-banner">{{ resources.error }}</div>

    <ResourcePreviewCard
      v-if="resources.previewItem"
      :item="resources.previewItem"
      :saving="resources.saving"
      @cancel="cancelPreview"
      @commit="commitPreview"
    />

    <div class="resource-board surface" :class="{ 'nebula-mode': activePage === 'nebula' }">
      <div class="resource-page-tabs" role="tablist" aria-label="Resource pages">
        <button
          v-for="page in pages"
          :key="page.value"
          class="resource-page-tab"
          :class="{ active: activePage === page.value }"
          type="button"
          @click="activePage = page.value"
        >
          <component :is="page.icon" :size="15" />
          <span>{{ preferences.t(page.labelKey) }}</span>
        </button>
      </div>

      <div v-if="activePage === 'cards'" class="resource-finder-workbench">
        <ResourceLibraryPanel
          v-model:query="query"
          :active-category-major="activeCategoryMajor"
          :active-category-node="activeCategoryNode"
          :active-filter="activeFilter"
          :all-items="resources.items"
          :category-tree="categoryTree"
          :counts="counts"
          :empty-state-description="emptyStateDescription"
          :empty-state-title="emptyStateTitle"
          :filtered-items="filteredItems"
          :filters="filters"
          :loading="resources.loading"
          :selected-id="selected?.id"
          @clear-filters="clearFilters"
          @refresh="refresh"
          @select="selectResource"
          @set-base-filter="setBaseFilter"
          @set-major-category="setMajorCategory"
          @set-minor-category="setMinorCategory"
        />

        <ResourceDetailPage
          :context-copying="copyingContext"
          :duplicate-relations="duplicateRelations"
          :item="selected"
          :related-resources="relatedResources"
          :source-preview-blocks="sourcePreviewBlocks"
          @back="activePage = 'cards'"
          @copy-context="copyContext"
          @remove="removeSelected"
          @select="selectResource"
          @set-status="setStatus"
        />
      </div>

      <section v-else class="resource-panel resource-nebula-page">
        <ResourceRadarScene :items="resources.items" :selected-id="selected?.id" @select="selectResource" @preview="focusResource" />
      </section>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { FileText, Radar } from "lucide-vue-next";
import type { ResourceStatus } from "../../api";
import { usePreferencesStore, type MessageKey } from "../../stores/preferences";
import { useNotificationsStore } from "../../stores/notifications";
import { useResourcesStore } from "../../stores/resources";
import ResourceCaptureBar from "./ResourceCaptureBar.vue";
import ResourceDetailPage from "./ResourceDetailPage.vue";
import ResourceLibraryPanel from "./ResourceLibraryPanel.vue";
import ResourcePreviewCard from "./ResourcePreviewCard.vue";
import ResourceRadarScene from "./ResourceRadarScene.vue";
import { isResourceStatus, sourcePreviewText, toReadableBlocks } from "./resource-display";
import type { ResourceFilter } from "./resource-filters";
import {
  buildResourceIndex,
  categoryFilterValue,
  countResourceIndex,
  filterResourceIndex,
  getCategoryTreeFromIndex,
  parseCategoryFilter
} from "./resource-filters";
import { getResourceRelations } from "./resource-insights";

type ResourcePage = "cards" | "nebula";

const resources = useResourcesStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const sourceUrl = ref("");
const sourceText = ref("");
const importInput = ref<HTMLInputElement | undefined>();
const captureExpanded = ref(false);
const query = ref("");
const debouncedQuery = ref("");
const activeFilter = ref<ResourceFilter>("all");
const activePage = ref<ResourcePage>("cards");
const copyingContext = ref(false);
let queryDebounceTimer: number | undefined;

const baseFilters: Array<{ value: ResourceFilter; labelKey: MessageKey }> = [
  { value: "all", labelKey: "resourceAll" },
  { value: "inbox", labelKey: "resourceInbox" },
  { value: "useful", labelKey: "resourceUseful" },
  { value: "archived", labelKey: "resourceArchived" }
];

const pages: Array<{ value: ResourcePage; labelKey: MessageKey; icon: Component }> = [
  { value: "cards", labelKey: "resourceCards", icon: FileText },
  { value: "nebula", labelKey: "resourceNebula", icon: Radar }
];

const selected = computed(() => resources.selectedItem);
const canSubmit = computed(() => sourceUrl.value.trim().length > 0 || sourceText.value.trim().length > 0);
const resourceIndex = computed(() => buildResourceIndex(resources.items));
const filteredEntries = computed(() => filterResourceIndex(resourceIndex.value, { query: debouncedQuery.value, filter: activeFilter.value }));
const filteredItems = computed(() => filteredEntries.value.map((entry) => entry.item));
const counts = computed(() => countResourceIndex(resourceIndex.value));
const filters = computed<Array<{ value: ResourceFilter; labelKey?: MessageKey; label?: string }>>(() => [...baseFilters]);
const categoryTree = computed(() => getCategoryTreeFromIndex(resourceIndex.value));
const activeCategoryMajor = computed(() => parseCategoryFilter(activeFilter.value)?.major ?? "");
const activeCategoryNode = computed(() => categoryTree.value.find((node) => node.major === activeCategoryMajor.value));
const sourcePreviewBlocks = computed(() => {
  const item = selected.value;
  if (!item) return [preferences.t("resourceSourceTextMissing")];
  return toReadableBlocks(sourcePreviewText(item), preferences.t("resourceSourceTextMissing"));
});
const relatedResources = computed(() => (selected.value ? getResourceRelations(resources.items, selected.value, 4) : []));
const duplicateRelations = computed(() => relatedResources.value.filter((relation) => relation.duplicate));
const emptyStateTitle = computed(() =>
  resources.items.length === 0 ? preferences.t("resourceEmptyLibraryTitle") : preferences.t("resourceNoMatchesTitle")
);
const emptyStateDescription = computed(() =>
  resources.items.length === 0 ? preferences.t("resourceEmptyLibraryDescription") : preferences.t("resourceNoMatchesDescription")
);

onMounted(() => {
  void refresh();
});

onBeforeUnmount(() => {
  if (queryDebounceTimer) window.clearTimeout(queryDebounceTimer);
});

watch(query, (value) => {
  if (queryDebounceTimer) window.clearTimeout(queryDebounceTimer);
  queryDebounceTimer = window.setTimeout(() => {
    debouncedQuery.value = value;
  }, resources.items.length > 300 ? 120 : 0);
});

async function refresh(): Promise<void> {
  await resources.load();
}

async function exportLibrary(): Promise<void> {
  const payload = await resources.exportLibrary();
  if (!payload) {
    notifications.error(resources.error || preferences.t("resourceExportFailed"));
    return;
  }
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  link.href = url;
  link.download = `dev-cockpit-resources-${date}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  notifications.success(preferences.t("resourceExportedNotice", { count: payload.items.length }));
}

function openImportPicker(): void {
  importInput.value?.click();
}

async function importLibraryFile(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  try {
    const payload = JSON.parse(await file.text()) as unknown;
    const result = await resources.importLibrary(payload);
    if (!result) {
      notifications.error(resources.error || preferences.t("resourceImportFailed"));
      return;
    }
    notifications.success(preferences.t("resourceImportedNotice", { added: result.added, skipped: result.skipped }));
  } catch (error) {
    notifications.error(preferences.t("resourceImportFailedWithMessage", { message: error instanceof Error ? error.message : String(error) }));
  }
}

async function submitResource(): Promise<void> {
  if (!canSubmit.value) {
    resources.setError(preferences.t("resourceInputRequired"));
    return;
  }
  const preview = await resources.preview({ sourceUrl: sourceUrl.value, sourceText: sourceText.value, outputLocale: preferences.locale });
  if (!preview) return;
  activePage.value = "cards";
}

async function commitPreview(): Promise<void> {
  const created = await resources.commitPreview();
  if (!created) return;
  sourceUrl.value = "";
  sourceText.value = "";
  captureExpanded.value = false;
  activePage.value = "cards";
}

function cancelPreview(): void {
  resources.clearPreview();
}

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

function selectResource(id: string): void {
  resources.select(id);
  activePage.value = "cards";
}

function focusResource(id: string): void {
  resources.select(id);
  activePage.value = "nebula";
}

async function setStatus(value: ResourceStatus): Promise<void> {
  const item = selected.value;
  if (!item || !isResourceStatus(value)) return;
  await resources.update(item.id, { status: value });
}

async function removeSelected(): Promise<void> {
  const item = selected.value;
  if (!item) return;
  await resources.remove(item.id);
}

async function copyContext(): Promise<void> {
  if (copyingContext.value) return;
  copyingContext.value = true;
  try {
    const context = await resources.loadContext();
    if (!context) {
      notifications.error(resources.error || preferences.t("resourceCopyContextFailed"));
      return;
    }
    await navigator.clipboard.writeText(context);
    notifications.success(preferences.t("resourceContextCopied"));
    activePage.value = "cards";
  } catch (error) {
    notifications.error(
      preferences.t("resourceCopyContextFailedWithMessage", { message: error instanceof Error ? error.message : String(error) })
    );
  } finally {
    copyingContext.value = false;
  }
}
</script>
