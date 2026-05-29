import { describe, expect, it } from "vitest";
import type { RadarItem } from "../../api";
import {
  metadataLinks,
  previewImage,
  resourceDecisionSummary,
  resourceFacts,
  resourceHighlightBullets,
  resourceReviewBullets,
  resourceUseCaseBullets
} from "./resource-display";

function resource(overrides: Partial<RadarItem> = {}): RadarItem {
  return {
    id: "r1",
    title: "Demo resource",
    sourceUrl: "https://github.com/DavidHDev/react-bits",
    kind: "tool",
    category: "工具 / 前端开发",
    categoryPath: ["工具", "前端开发"],
    tags: [],
    status: "inbox",
    confidence: 88,
    summary: "A resource.",
    createdAt: "2026-05-28T00:00:00.000Z",
    updatedAt: "2026-05-28T00:00:00.000Z",
    ...overrides
  };
}

describe("resource display helpers", () => {
  it("derives GitHub preview, facts, and links for legacy resources without metadata", () => {
    const item = resource();

    expect(previewImage(item)).toBe("https://opengraph.githubassets.com/dev-cockpit/DavidHDev/react-bits");
    expect(resourceFacts(item)).toContain("DavidHDev/react-bits");
    expect(metadataLinks(item)).toEqual([
      { label: "GitHub", url: "https://github.com/DavidHDev/react-bits" },
      { label: "README", url: "https://raw.githubusercontent.com/DavidHDev/react-bits/HEAD/README.md" }
    ]);
  });

  it("keeps fetched metadata links first and appends missing GitHub fallbacks", () => {
    const item = resource({
      rawMetadata: {
        links: [{ label: "Homepage", url: "https://reactbits.dev/" }]
      }
    });

    expect(metadataLinks(item)).toEqual([
      { label: "Homepage", url: "https://reactbits.dev/" },
      { label: "GitHub", url: "https://github.com/DavidHDev/react-bits" },
      { label: "README", url: "https://raw.githubusercontent.com/DavidHDev/react-bits/HEAD/README.md" }
    ]);
  });

  it("builds decision bullets from structured AI analysis", () => {
    const item = resource({
      highlights: ["组件多", "可复制"],
      useCases: ["快速搭建动画页面"],
      evidence: ["README 提到 110+ components"]
    });

    expect(resourceDecisionSummary(item)).toContain("工具 / 前端开发");
    expect(resourceHighlightBullets(item)).toEqual(["组件多", "可复制"]);
    expect(resourceUseCaseBullets(item)).toEqual(["快速搭建动画页面"]);
    expect(resourceReviewBullets(item)).toEqual(["README 提到 110+ components"]);
  });

  it("builds safe fallback decision bullets for older resources", () => {
    const item = resource({ rawMetadata: undefined, analysisSource: "rules" });

    expect(resourceHighlightBullets(item)[0]).toContain("工具 / 前端开发");
    expect(resourceUseCaseBullets(item)[0]).toContain("前端开发");
    expect(resourceReviewBullets(item)).toContain("当前主要来自本地规则，建议结合来源页面复核价值。");
  });
});
