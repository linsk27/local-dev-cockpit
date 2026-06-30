import { computed, ref } from "vue";
import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";
import type { RadarItem } from "../../api";
import { buildResourceIndex, filterResourceIndex, getCategoryTreeFromIndex, parseCategoryFilter, type ResourceFilter } from "./resource-filters";
import { useResourceExport } from "./use-resource-export";

describe("useResourceExport", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
  });

  it("builds export scopes from current library state", () => {
    const resources = ref([resource("alpha", "工具", "前端开发"), resource("beta", "Skills", "AI 编程辅助")]);
    const query = ref("");
    const activeFilter = ref<ResourceFilter>("all");
    const resourceIndex = computed(() => buildResourceIndex(resources.value));
    const filteredEntries = computed(() => filterResourceIndex(resourceIndex.value, { query: query.value, filter: activeFilter.value }));
    const filteredItems = computed(() => filteredEntries.value.map((entry) => entry.item));
    const categoryTree = computed(() => getCategoryTreeFromIndex(resourceIndex.value));
    const activeCategoryMajor = computed(() => parseCategoryFilter(activeFilter.value)?.major ?? "");
    const selected = computed(() => resources.value[1]);

    const exporting = useResourceExport({
      activeCategoryMajor,
      activeFilter,
      categoryTree,
      filteredItems,
      query,
      resourceIndex,
      resources: computed(() => resources.value),
      selected
    });

    exporting.exportMode.value = "selected";
    expect(exporting.buildExportPayload().items.map((item) => item.id)).toEqual(["beta"]);

    exporting.exportMode.value = "category";
    exporting.setExportCategory("工具");
    expect(exporting.buildExportPayload().items.map((item) => item.id)).toEqual(["alpha"]);

    activeFilter.value = "category:Skills";
    exporting.openExportDialog();
    expect(exporting.exportMode.value).toBe("filtered");
    expect(exporting.exportItems.value.map((item) => item.id)).toEqual(["beta"]);
  });
});

function resource(id: string, major: string, minor: string): RadarItem {
  return {
    id,
    title: id,
    sourceUrl: `https://example.com/${id}`,
    kind: "tool",
    category: `${major} / ${minor}`,
    categoryPath: [major, minor],
    tags: [id],
    status: "inbox",
    confidence: 90,
    summary: `${id} summary`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
