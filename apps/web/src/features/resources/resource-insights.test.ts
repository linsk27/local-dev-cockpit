import { describe, expect, it } from "vitest";
import type { RadarItem } from "../../api";
import { getResourceRelations } from "./resource-insights";

describe("resource insights", () => {
  it("detects duplicate sources after URL normalization", () => {
    const current = resource({
      id: "current",
      sourceUrl: "https://github.com/example/tool?tab=readme#install"
    });
    const duplicate = resource({
      id: "duplicate",
      sourceUrl: "https://github.com/example/tool/"
    });

    const relations = getResourceRelations([current, duplicate], current);

    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
      item: duplicate,
      duplicate: true,
      score: 100
    });
    expect(relations[0].reasons).toContain("same-source");
  });

  it("ranks resources by matching type, category, subcategory, and tags", () => {
    const current = resource({
      id: "current",
      title: "React animation snippets",
      kind: "github-repo",
      categoryPath: ["Tools", "Frontend"],
      tags: ["react", "animation"]
    });
    const related = resource({
      id: "related",
      title: "React animation components",
      kind: "github-repo",
      categoryPath: ["Tools", "Frontend"],
      tags: ["react", "ui"]
    });

    const [relation] = getResourceRelations([current, related], current);

    expect(relation.item.id).toBe("related");
    expect(relation.duplicate).toBe(false);
    expect(relation.reasons).toEqual(
      expect.arrayContaining(["same-kind", "same-category", "same-subcategory", "tag-overlap", "title-overlap"])
    );
    expect(relation.score).toBeGreaterThanOrEqual(60);
  });

  it("filters unrelated resources", () => {
    const current = resource({
      id: "current",
      title: "React animation snippets",
      kind: "github-repo",
      categoryPath: ["Tools", "Frontend"],
      tags: ["react"]
    });
    const unrelated = resource({
      id: "unrelated",
      title: "Speech cloning workflow",
      kind: "workflow",
      categoryPath: ["Workflow", "Voice"],
      tags: ["audio"]
    });

    expect(getResourceRelations([current, unrelated], current)).toEqual([]);
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
