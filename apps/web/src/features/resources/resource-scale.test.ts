import { describe, expect, it } from "vitest";
import type { RadarItem } from "../../api";
import {
  buildResourceIndex,
  categoryFilterValue,
  countResourceIndex,
  filterResourceIndex,
  getCategoryTreeFromIndex
} from "./resource-filters";
import { RESOURCE_VIRTUAL_LIST_THRESHOLD, calculateVirtualResourceWindow, shouldVirtualizeResourceList } from "./resource-virtual-list";

describe("resource scale helpers", () => {
  it("indexes and filters 1000 resources without recomputing display fields per filter", () => {
    const items = Array.from({ length: 1000 }, (_, index) =>
      resource({
        id: `resource-${index}`,
        title: index % 2 === 0 ? `React tool ${index}` : `Video workflow ${index}`,
        kind: index % 3 === 0 ? "tool" : index % 3 === 1 ? "workflow" : "demo",
        status: index % 4 === 0 ? "useful" : "inbox",
        sourceUrl: index % 2 === 0 ? `https://github.com/example/react-${index}` : `https://example.com/video-${index}`,
        categoryPath: index % 2 === 0 ? ["工具", "前端开发"] : ["Workflow", "视频剪辑"],
        tags: index % 2 === 0 ? ["react", "ui"] : ["video", "automation"]
      })
    );

    const index = buildResourceIndex(items);
    expect(index).toHaveLength(1000);

    const counts = countResourceIndex(index);
    expect(counts.all).toBe(1000);
    expect(counts.useful).toBe(250);
    expect(counts[categoryFilterValue("工具")]).toBe(500);
    expect(counts[categoryFilterValue("工具", "前端开发")]).toBe(500);

    expect(filterResourceIndex(index, { query: "github.com/example", filter: categoryFilterValue("工具") })).toHaveLength(500);
    expect(filterResourceIndex(index, { query: "", filter: "workflow" })).toHaveLength(333);
    expect(filterResourceIndex(index, { query: "video", filter: "all" })).toHaveLength(500);
    expect(getCategoryTreeFromIndex(index).map((node) => [node.major, node.count])).toEqual([
      ["工具", 500],
      ["Workflow", 500]
    ]);
  });

  it("calculates a fixed-row virtual window instead of rendering every resource", () => {
    const window = calculateVirtualResourceWindow({
      total: 1000,
      rowHeight: 110,
      viewportHeight: 440,
      scrollTop: 110 * 400,
      overscan: 6
    });

    expect(window.totalHeight).toBe(110000);
    expect(window.startIndex).toBe(394);
    expect(window.endIndex).toBe(410);
    expect(window.endIndex - window.startIndex).toBe(16);
    expect(window.offsetTop).toBe(394 * 110);
  });

  it("uses natural rendering for small resource libraries", () => {
    expect(RESOURCE_VIRTUAL_LIST_THRESHOLD).toBe(80);
    expect(shouldVirtualizeResourceList(0)).toBe(false);
    expect(shouldVirtualizeResourceList(12)).toBe(false);
    expect(shouldVirtualizeResourceList(80)).toBe(false);
    expect(shouldVirtualizeResourceList(81)).toBe(true);
    expect(shouldVirtualizeResourceList(1000)).toBe(true);
  });
});

function resource(overrides: Partial<RadarItem>): RadarItem {
  return {
    id: "resource",
    title: "Resource",
    kind: "unknown",
    category: "未分类",
    categoryPath: ["未分类"],
    tags: [],
    status: "inbox",
    confidence: 60,
    summary: "summary",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides
  };
}
