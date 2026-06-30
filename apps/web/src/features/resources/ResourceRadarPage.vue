<template>
  <section class="resource-page">
    <ResourceCaptureBar
      :count="resources.items.length"
      :import-exporting="resources.importExporting"
      :previewing="resources.previewing"
      @export="openExportDialog"
      @import="openImportDialog"
      @submit="openCaptureDialog"
    />

    <div v-if="resources.error" class="error-banner">{{ resources.error }}</div>

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
          @copy-source="copySourceUrl"
          @remove="removeSelected"
          @select="selectResource"
          @set-status="setStatus"
        />
      </div>

      <section v-else class="resource-panel resource-nebula-page">
        <ResourceRadarScene :items="resources.items" :selected-id="selected?.id" @select="selectResource" @preview="focusResource" />
      </section>
    </div>

    <ResourceParseDialog
      v-if="captureDialogOpen"
      v-model:source-text="sourceText"
      v-model:source-url="sourceUrl"
      :can-submit="canSubmit"
      :error="resources.error"
      :preview-item="resources.previewItem"
      :previewing="resources.previewing"
      :saving="resources.saving"
      @cancel-preview="cancelPreview"
      @close="closeCaptureDialog"
      @commit-preview="commitPreview"
      @submit="submitResource"
    />

    <ResourceImportDialog
      v-if="importDialogOpen"
      :import-exporting="resources.importExporting"
      @close="closeImportDialog"
      @import-file="importLibraryFile"
    />

    <ResourceExportDialog
      v-if="exportDialogOpen"
      v-model:export-mode="exportMode"
      :category-options="exportCategoryOptions"
      :export-category-label="exportCategoryLabel"
      :export-category-value="exportCategoryValue"
      :export-items-count="exportItems.length"
      :export-status="exportStatus"
      :export-status-label="exportStatusLabel"
      :open-picker="openExportPicker"
      :options="exportOptions"
      :status-options="exportStatusOptions"
      @close="closeExportDialog"
      @close-picker="closeExportPicker"
      @export="exportLibrary"
      @set-category="setExportCategory"
      @set-status="setExportStatus"
      @toggle-picker="toggleExportPicker"
    />
  </section>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch, type Component } from "vue";
import { FileText, Radar } from "lucide-vue-next";
import { usePreferencesStore, type MessageKey } from "../../stores/preferences";
import { useNotificationsStore } from "../../stores/notifications";
import { useResourcesStore } from "../../stores/resources";
import ResourceCaptureBar from "./ResourceCaptureBar.vue";
import ResourceDetailPage from "./ResourceDetailPage.vue";
import ResourceExportDialog from "./ResourceExportDialog.vue";
import ResourceImportDialog from "./ResourceImportDialog.vue";
import ResourceLibraryPanel from "./ResourceLibraryPanel.vue";
import ResourceParseDialog from "./ResourceParseDialog.vue";
import ResourceRadarScene from "./ResourceRadarScene.vue";
import { useResourceActions } from "./use-resource-actions";
import { useResourceCapture } from "./use-resource-capture";
import { useResourceExport } from "./use-resource-export";
import { useResourceFilters } from "./use-resource-filters";
import { useResourceSelection } from "./use-resource-selection";

type ResourcePage = "cards" | "nebula";

const resources = useResourcesStore();
const preferences = usePreferencesStore();
const notifications = useNotificationsStore();
const activePage = ref<ResourcePage>("cards");
const importDialogOpen = ref(false);
const resourceItems = computed(() => resources.items);

const pages: Array<{ value: ResourcePage; labelKey: MessageKey; icon: Component }> = [
  { value: "cards", labelKey: "resourceCards", icon: FileText },
  { value: "nebula", labelKey: "resourceNebula", icon: Radar }
];

const {
  activeCategoryMajor,
  activeCategoryNode,
  activeFilter,
  categoryTree,
  clearFilters,
  counts,
  disposeResourceFilters,
  filteredItems,
  filters,
  query,
  resourceIndex,
  setBaseFilter,
  setMajorCategory,
  setMinorCategory
} = useResourceFilters(resourceItems);
const { duplicateRelations, relatedResources, selected, selectResource: selectResourceItem, sourcePreviewBlocks } = useResourceSelection();
const { copyingContext, copyContext: copyResourceContext, copySourceUrl, removeSelected, setStatus } = useResourceActions(selected);
const {
  canSubmit,
  cancelPreview,
  captureDialogOpen,
  closeCaptureDialog,
  commitPreview: commitResourcePreview,
  openCaptureDialog,
  sourceText,
  sourceUrl,
  submitResource: submitResourcePreview
} = useResourceCapture();
const {
  buildExportPayload,
  closeExportDialog,
  closeExportPicker,
  exportCategoryLabel,
  exportCategoryOptions,
  exportCategoryValue,
  exportDialogOpen,
  exportItems,
  exportMode,
  exportOptions,
  exportStatus,
  exportStatusLabel,
  exportStatusOptions,
  openExportDialog,
  openExportPicker,
  setExportCategory,
  setExportStatus,
  syncExportMode,
  toggleExportPicker
} = useResourceExport({
  activeCategoryMajor,
  activeFilter,
  categoryTree,
  filteredItems,
  query,
  resourceIndex,
  resources: resourceItems,
  selected
});

const emptyStateTitle = computed(() =>
  resources.items.length === 0 ? preferences.t("resourceEmptyLibraryTitle") : preferences.t("resourceNoMatchesTitle")
);
const emptyStateDescription = computed(() =>
  resources.items.length === 0 ? preferences.t("resourceEmptyLibraryDescription") : preferences.t("resourceNoMatchesDescription")
);

onMounted(() => {
  void refresh();
});

onBeforeUnmount(disposeResourceFilters);

watch(exportMode, syncExportMode);

watch(exportDialogOpen, (open) => {
  if (!open) closeExportPicker();
});

async function refresh(): Promise<void> {
  await resources.load();
}

function openImportDialog(): void {
  importDialogOpen.value = true;
}

function closeImportDialog(): void {
  importDialogOpen.value = false;
}

async function exportLibrary(): Promise<void> {
  const items = exportItems.value;
  if (items.length === 0) {
    notifications.error(preferences.t("resourceExportFailed"));
    return;
  }
  const payload = buildExportPayload();
  const blob = new Blob([`${JSON.stringify(payload, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const date = new Date().toISOString().slice(0, 10);
  try {
    link.href = url;
    link.download = `dev-cockpit-resources-${exportMode.value}-${date}.json`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    closeExportDialog();
    notifications.success(preferences.t("resourceExportedNotice", { count: payload.items.length }));
  } finally {
    URL.revokeObjectURL(url);
  }
}

async function importLibraryFile(file: File): Promise<void> {
  try {
    const payload = JSON.parse(await file.text()) as unknown;
    const result = await resources.importLibrary(payload);
    if (!result) {
      notifications.error(resources.error || preferences.t("resourceImportFailed"));
      return;
    }
    closeImportDialog();
    notifications.success(preferences.t("resourceImportedNotice", { added: result.added, skipped: result.skipped }));
  } catch (error) {
    notifications.error(preferences.t("resourceImportFailedWithMessage", { message: error instanceof Error ? error.message : String(error) }));
  }
}

async function submitResource(): Promise<void> {
  if (await submitResourcePreview()) activePage.value = "cards";
}

async function commitPreview(): Promise<void> {
  if (await commitResourcePreview()) activePage.value = "cards";
}

function selectResource(id: string): void {
  selectResourceItem(id);
  activePage.value = "cards";
}

function focusResource(id: string): void {
  selectResourceItem(id);
  activePage.value = "nebula";
}

async function copyContext(): Promise<void> {
  if (await copyResourceContext()) activePage.value = "cards";
}
</script>
