import { describe, expect, it } from "vitest";
import type { RadarItem } from "../../api";
import {
  categoryFilterValue,
  countResourceFilters,
  filterResources,
  getCategoryTree,
  getMajorCategories,
  groupResourcesByCategory
} from "./resource-filters";

describe("resource filters", () => {
  it("filters by status, kind, and text", () => {
    const items = [
      resource({ id: "1", title: "MiroFish Demo", kind: "demo", status: "inbox", tags: ["demo"] }),
      resource({ id: "2", title: "GSAP Skill", kind: "skill-md", status: "useful", tags: ["animation"] })
    ];

    expect(filterResources(items, { query: "", filter: "demo" }).map((item) => item.id)).toEqual(["1"]);
    expect(filterResources(items, { query: "", filter: "useful" }).map((item) => item.id)).toEqual(["2"]);
    expect(filterResources(items, { query: "animation", filter: "all" }).map((item) => item.id)).toEqual(["2"]);
  });

  it("counts buckets and groups by category", () => {
    const items = [
      resource({ id: "1", category: "Demo", categoryPath: ["Demo"], kind: "demo", status: "inbox" }),
      resource({ id: "2", category: "Demo", categoryPath: ["Demo"], kind: "tool", status: "archived" }),
      resource({ id: "3", category: "Prompt", categoryPath: ["Prompt"], kind: "prompt", status: "useful" })
    ];

    expect(countResourceFilters(items)).toMatchObject({ all: 3, demo: 1, tool: 1, prompt: 1, archived: 1 });
    expect(groupResourcesByCategory(items).map((group) => [group.category, group.items.length])).toEqual([
      ["Demo", 2],
      ["Prompt", 1]
    ]);
  });

  it("filters and groups by dynamic major and minor categories", () => {
    const items = [
      resource({ id: "1", category: "工具 / 前端开发", categoryPath: ["工具", "前端开发"] }),
      resource({ id: "2", category: "工具 / 视觉设计", categoryPath: ["工具", "视觉设计"] }),
      resource({ id: "3", category: "教程文章 / PPT生成", categoryPath: ["教程文章", "PPT生成"] })
    ];

    expect(getMajorCategories(items)).toEqual(["工具", "教程文章"]);
    expect(getCategoryTree(items)).toEqual([
      {
        major: "工具",
        count: 2,
        children: [
          { minor: "前端开发", count: 1 },
          { minor: "视觉设计", count: 1 }
        ]
      },
      { major: "教程文章", count: 1, children: [{ minor: "PPT生成", count: 1 }] }
    ]);
    expect(filterResources(items, { query: "", filter: categoryFilterValue("工具") }).map((item) => item.id)).toEqual(["1", "2"]);
    expect(filterResources(items, { query: "", filter: categoryFilterValue("工具", "前端开发") }).map((item) => item.id)).toEqual(["1"]);
    expect(filterResources(items, { query: "", filter: categoryFilterValue("教程文章") }).map((item) => item.id)).toEqual(["3"]);
    expect(groupResourcesByCategory(items).map((group) => group.category)).toEqual(["工具 / 前端开发", "工具 / 视觉设计", "教程文章 / PPT生成"]);

    const counts = countResourceFilters(items);
    expect(counts[categoryFilterValue("工具")]).toBe(2);
    expect(counts[categoryFilterValue("工具", "前端开发")]).toBe(1);
    expect(counts[categoryFilterValue("教程文章", "PPT生成")]).toBe(1);
  });
});

function resource(overrides: Partial<RadarItem>): RadarItem {
  return {
    id: "resource",
    title: "Resource",
    kind: "unknown",
    category: "Inbox",
    tags: [],
    status: "inbox",
    confidence: 40,
    summary: "summary",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides
  };
}
