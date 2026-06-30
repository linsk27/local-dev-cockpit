import { computed, ref, type ComputedRef, type Ref } from "vue";
import type { RadarItem, ResourceExportPayload, ResourceStatus } from "../../api";
import { usePreferencesStore } from "../../stores/preferences";
import type { ResourceExportMode, ResourceExportOption, ResourceExportPicker } from "./resource-export-dialog";
import type { ResourceCategoryNode, ResourceFilter, ResourceIndexEntry } from "./resource-filters";

interface UseResourceExportOptions {
  activeCategoryMajor: ComputedRef<string>;
  activeFilter: Ref<ResourceFilter>;
  categoryTree: ComputedRef<ResourceCategoryNode[]>;
  filteredItems: ComputedRef<RadarItem[]>;
  query: Ref<string>;
  resourceIndex: ComputedRef<ResourceIndexEntry[]>;
  resources: ComputedRef<RadarItem[]>;
  selected: ComputedRef<RadarItem | undefined>;
}

export function useResourceExport(options: UseResourceExportOptions) {
  const preferences = usePreferencesStore();
  const exportDialogOpen = ref(false);
  const exportMode = ref<ResourceExportMode>("all");
  const exportStatus = ref<ResourceStatus>("inbox");
  const exportCategory = ref("");
  const openExportPicker = ref<ResourceExportPicker>("");

  const exportStatusOptions = computed<Array<{ value: ResourceStatus; label: string }>>(() => [
    { value: "inbox", label: preferences.t("resourceInbox") },
    { value: "useful", label: preferences.t("resourceUseful") },
    { value: "archived", label: preferences.t("resourceArchived") }
  ]);

  const exportStatusLabel = computed(() => exportStatusOptions.value.find((status) => status.value === exportStatus.value)?.label ?? "");

  const exportCategoryOptions = computed(() =>
    options.categoryTree.value.map((node) => ({ value: node.major, label: `${node.major} (${node.count})`, count: node.count }))
  );

  const exportCategoryValue = computed(() => exportCategory.value || options.categoryTree.value[0]?.major || "");

  const exportCategoryLabel = computed(() => {
    const option = exportCategoryOptions.value.find((node) => node.value === exportCategoryValue.value);
    return option?.label ?? (preferences.locale !== "en-US" ? "没有分类" : "No category");
  });

  const exportOptions = computed<ResourceExportOption[]>(() => {
    const zh = preferences.locale !== "en-US";
    const selectedCount = options.selected.value ? 1 : 0;
    const categoryCount = exportCategory.value
      ? options.resourceIndex.value.filter((entry) => entry.major === exportCategory.value).length
      : (options.categoryTree.value[0]?.count ?? 0);

    return [
      {
        mode: "all",
        label: zh ? "全部资源" : "All resources",
        description: zh ? "完整资源库备份" : "Full library backup",
        count: options.resources.value.length
      },
      {
        mode: "filtered",
        label: zh ? "当前筛选" : "Current filter",
        description: zh ? "导出当前列表里看到的资源" : "Export the resources currently shown",
        count: options.filteredItems.value.length
      },
      {
        mode: "selected",
        label: zh ? "当前选中" : "Selected item",
        description: options.selected.value?.title ?? (zh ? "还没有选中资源" : "No resource selected"),
        count: selectedCount
      },
      {
        mode: "status",
        label: zh ? "按状态" : "By status",
        description: exportStatusOptions.value.find((status) => status.value === exportStatus.value)?.label ?? "",
        count: options.resources.value.filter((item) => item.status === exportStatus.value).length
      },
      {
        mode: "category",
        label: zh ? "按分类" : "By category",
        description: exportCategory.value || options.categoryTree.value[0]?.major || (zh ? "没有分类" : "No category"),
        count: categoryCount
      }
    ];
  });

  const exportItems = computed<RadarItem[]>(() => {
    if (exportMode.value === "filtered") return options.filteredItems.value;
    if (exportMode.value === "selected") return options.selected.value ? [options.selected.value] : [];
    if (exportMode.value === "status") return options.resources.value.filter((item) => item.status === exportStatus.value);
    if (exportMode.value === "category") {
      const category = exportCategory.value || options.categoryTree.value[0]?.major || "";
      return options.resourceIndex.value.filter((entry) => entry.major === category).map((entry) => entry.item);
    }
    return options.resources.value;
  });

  function openExportDialog(): void {
    exportMode.value = options.activeFilter.value !== "all" || options.query.value.trim() ? "filtered" : "all";
    exportCategory.value = options.activeCategoryMajor.value || options.categoryTree.value[0]?.major || "";
    exportDialogOpen.value = true;
  }

  function closeExportDialog(): void {
    openExportPicker.value = "";
    exportDialogOpen.value = false;
  }

  function toggleExportPicker(picker: Exclude<ResourceExportPicker, "">): void {
    openExportPicker.value = openExportPicker.value === picker ? "" : picker;
  }

  function closeExportPicker(): void {
    openExportPicker.value = "";
  }

  function setExportStatus(value: ResourceStatus): void {
    exportStatus.value = value;
    closeExportPicker();
  }

  function setExportCategory(value: string): void {
    exportCategory.value = value;
    closeExportPicker();
  }

  function syncExportMode(): void {
    openExportPicker.value = "";
    if (exportMode.value === "category" && !exportCategory.value) {
      exportCategory.value = options.categoryTree.value[0]?.major || "";
    }
  }

  function buildExportPayload(): ResourceExportPayload {
    return {
      app: "dev-cockpit-resource-radar",
      version: 1,
      exportedAt: new Date().toISOString(),
      items: exportItems.value
    };
  }

  return {
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
  };
}
