import { describe, expect, it } from "vitest";
import type { RadarItem } from "../../api";
import {
  analysisNoteLabel,
  insightCards,
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
      highlights: ["组件丰富", "可复用"],
      useCases: ["快速搭建动画页面"],
      evidence: ["README 提到 110+ components"]
    });

    expect(resourceDecisionSummary(item)).toContain("工具 / 前端开发");
    expect(resourceHighlightBullets(item)).toEqual(["组件丰富", "可复用"]);
    expect(resourceUseCaseBullets(item)).toEqual(["快速搭建动画页面"]);
    expect(resourceReviewBullets(item)).toEqual(["README 提到 110+ components"]);
  });

  it("builds safe fallback decision bullets for older resources", () => {
    const item = resource({ rawMetadata: undefined, analysisSource: "rules" });

    expect(resourceHighlightBullets(item)[0]).toContain("工具 / 前端开发");
    expect(resourceUseCaseBullets(item)[0]).toContain("前端开发");
    expect(resourceReviewBullets(item)).toContain("当前主要来自本地规则，建议结合来源页面复核价值。");
  });

  it("normalizes AI schema errors into readable copy", () => {
    expect(analysisNoteLabel("AI returned invalid resource card schema")).toBe("AI 返回结构不符合资源卡片要求，已使用本地规则生成预览。");
  });

  it("makes AI timeout notes clear that the local card remains usable", () => {
    expect(analysisNoteLabel("AI 解析超时。")).toBe("AI 增强超时，已保留本地规则生成的资源卡。可稍后重试解析。");
  });

  it("uses clean Chinese labels for insight cards", () => {
    const item = resource({
      highlights: ["亮点 1"],
      useCases: ["用途 1"],
      evidence: ["依据 1"]
    });

    expect(insightCards(item)).toEqual([
      { title: "亮点", value: "亮点 1" },
      { title: "用途", value: "用途 1" },
      { title: "依据", value: "依据 1" }
    ]);
  });
});
