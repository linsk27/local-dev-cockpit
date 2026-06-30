import { computed, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";
import type { RadarItem } from "../../api";
import { useResourceFilters } from "./use-resource-filters";

describe("useResourceFilters", () => {
  it("indexes resources and filters by status or category", async () => {
    vi.useFakeTimers();
    const resources = ref([
      resource("alpha", "工具", "前端开发", "inbox"),
      resource("beta", "Skills", "AI 编程辅助", "useful")
    ]);
    const filters = useResourceFilters(computed(() => resources.value));

    expect(filters.counts.value.all).toBe(2);
    expect(filters.categoryTree.value.map((node) => node.major).sort()).toEqual(["Skills", "工具"].sort());

    filters.setBaseFilter("useful");
    expect(filters.filteredItems.value.map((item) => item.id)).toEqual(["beta"]);

    filters.setMajorCategory("工具");
    expect(filters.filteredItems.value.map((item) => item.id)).toEqual(["alpha"]);

    filters.query.value = "not-present";
    await nextTick();
    vi.runAllTimers();
    await nextTick();
    expect(filters.filteredItems.value).toEqual([]);

    filters.clearFilters();
    expect(filters.filteredItems.value.map((item) => item.id)).toEqual(["alpha", "beta"]);
    filters.disposeResourceFilters();
    vi.useRealTimers();
  });
});

function resource(id: string, major: string, minor: string, status: RadarItem["status"]): RadarItem {
  return {
    id,
    title: id,
    sourceUrl: `https://example.com/${id}`,
    kind: "tool",
    category: `${major} / ${minor}`,
    categoryPath: [major, minor],
    tags: [id],
    status,
    confidence: 90,
    summary: `${id} summary`,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}
