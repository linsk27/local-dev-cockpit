import type { RadarItem, ResourceKind, ResourceStatus } from "../../api";
import type { MessageKey, usePreferencesStore } from "../../stores/preferences";
import { displayCategory } from "./resource-filters";
import type { ResourceRelationReason } from "./resource-insights";

type PreferencesStore = ReturnType<typeof usePreferencesStore>;

export const statusOptions: Array<{ value: ResourceStatus; labelKey: MessageKey }> = [
  { value: "inbox", labelKey: "resourceInbox" },
  { value: "useful", labelKey: "resourceUseful" },
  { value: "archived", labelKey: "resourceArchived" }
];

export function sourceLabel(item: RadarItem, preferences: PreferencesStore): string {
  if (!item.sourceUrl) return preferences.t("resourceSourceText");
  try {
    return new URL(item.sourceUrl).hostname.replace(/^www\./, "");
  } catch {
    return item.sourceUrl;
  }
}

export function kindLabel(kind: ResourceKind, preferences: PreferencesStore): string {
  const labels: Record<ResourceKind, string> = {
    "skill-md": "Skill.md",
    "github-repo": preferences.t("resourceTool"),
    mcp: "MCP",
    prompt: "Prompt",
    workflow: "Workflow",
    demo: preferences.t("resourceDemo"),
    tool: preferences.t("resourceTool"),
    article: preferences.t("resourceArticle"),
    unknown: preferences.t("resourceUnknown")
  };
  return labels[kind];
}

export function categoryLabel(item: RadarItem): string {
  return displayCategory(item);
}

export function compactCategoryLabel(item: RadarItem, preferences: PreferencesStore): string {
  const path = item.categoryPath?.map((part) => part.trim()).filter(Boolean) ?? [];
  if (path.length >= 2) return path[1] ?? "";
  const category = path[0] ?? item.category ?? "";
  if (!category) return "";
  const kind = kindLabel(item.kind, preferences);
  return category === kind ? "" : category;
}

export function statusLabel(status: ResourceStatus, preferences: PreferencesStore): string {
  const labels: Record<ResourceStatus, string> = {
    inbox: preferences.t("resourceInbox"),
    useful: preferences.t("resourceUseful"),
    archived: preferences.t("resourceArchived")
  };
  return labels[status];
}

export function visibleTags(item: RadarItem): string[] {
  return item.tags.slice(0, 4);
}

export function analysisSourceLabel(source: RadarItem["analysisSource"], preferences: PreferencesStore): string {
  const labels: Record<NonNullable<RadarItem["analysisSource"]>, string> = {
    rules: preferences.t("resourceRules"),
    metadata: preferences.t("resourceMetadata"),
    ai: preferences.t("resourceAi"),
    mixed: preferences.t("resourceMixed")
  };
  return source ? labels[source] : preferences.t("resourceRules");
}

export function relationReasonLabel(reason: ResourceRelationReason, preferences: PreferencesStore): string {
  const labels: Record<ResourceRelationReason, string> = {
    "same-source": preferences.t("resourceRelationSameSource"),
    "same-kind": preferences.t("resourceRelationSameKind"),
    "same-category": preferences.t("resourceRelationSameCategory"),
    "same-subcategory": preferences.t("resourceRelationSameSubcategory"),
    "same-host": preferences.t("resourceRelationSameHost"),
    "tag-overlap": preferences.t("resourceRelationTagOverlap"),
    "title-overlap": preferences.t("resourceRelationTitleOverlap")
  };
  return labels[reason];
}

export function analysisNoteLabel(message: string): string {
  if (/AI.*schema|resource card\s*schema|AI.*structure|AI returned invalid|AI analysis incomplete|AI 返回结构|结构不符合|schema/i.test(message)) {
    return "AI 返回结构不符合资源卡片要求，已使用本地规则生成预览。";
  }
  return message;
}

export interface ResourceImageView {
  label: string;
  url: string;
  source?: string;
}

export function resourceImages(item: RadarItem): ResourceImageView[] {
  const metadataImages = Array.isArray(item.rawMetadata?.images) ? item.rawMetadata.images : [];
  const candidates: Array<ResourceImageView | undefined> = [
    item.previewImageUrl ? { label: "Preview", url: item.previewImageUrl, source: "preview" } : undefined,
    ...metadataImages
      .filter((image) => typeof image?.url === "string" && typeof image?.label === "string")
      .map((image) => ({ label: image.label, url: image.url, source: image.source })),
    typeof item.rawMetadata?.imageUrl === "string" ? { label: "Preview", url: item.rawMetadata.imageUrl, source: "metadata" } : undefined,
    githubOpenGraphImage(item.sourceUrl) ? { label: "GitHub preview", url: githubOpenGraphImage(item.sourceUrl), source: "github-open-graph" } : undefined
  ];
  const seen = new Set<string>();
  const output: ResourceImageView[] = [];
  for (const image of candidates) {
    if (!image?.url || seen.has(image.url)) continue;
    seen.add(image.url);
    output.push({ label: image.label || "Preview", url: image.url, source: image.source });
    if (output.length >= 8) break;
  }
  return output;
}

export function previewImage(item: RadarItem): string {
  return resourceImages(item)[0]?.url ?? "";
}

function githubOpenGraphImage(sourceUrl: string | undefined): string {
  if (!sourceUrl) return "";
  const normalized = /^https?:\/\//i.test(sourceUrl) ? sourceUrl : `https://${sourceUrl}`;
  try {
    const url = new URL(normalized);
    if (!/github\.com$/i.test(url.hostname)) return "";
    const [owner, repoWithSuffix] = url.pathname.split("/").filter(Boolean);
    const repo = repoWithSuffix?.replace(/\.git$/i, "");
    return owner && repo ? `https://opengraph.githubassets.com/dev-cockpit/${owner}/${repo}` : "";
  } catch {
    return "";
  }
}

export function previewEvidence(item: RadarItem): string[] {
  return [...(item.highlights ?? []), ...(item.evidence ?? [])].filter(Boolean).slice(0, 3);
}

export function resourceFacts(item: RadarItem): string[] {
  const repo = item.rawMetadata?.repository;
  const repoInfo = githubRepoInfo(item.sourceUrl);
  const facts: string[] = [];
  if (repo?.fullName) facts.push(repo.fullName);
  else if (repoInfo) facts.push(repoInfo.fullName);
  if (repo?.language) facts.push(repo.language);
  if (typeof repo?.stars === "number") facts.push(`${repo.stars.toLocaleString()} Stars`);
  if (typeof repo?.forks === "number") facts.push(`${repo.forks.toLocaleString()} Forks`);
  if (item.rawMetadata?.siteName) facts.push(item.rawMetadata.siteName);
  return facts.slice(0, 5);
}

export function insightCards(item: RadarItem): Array<{ title: string; value: string }> {
  const cards: Array<{ title: string; value: string }> = [];
  for (const value of item.highlights ?? []) cards.push({ title: "亮点", value });
  for (const value of item.useCases ?? []) cards.push({ title: "用途", value });
  for (const value of item.evidence ?? []) cards.push({ title: "依据", value });
  return cards.slice(0, 6);
}

export function resourceDecisionSummary(item: RadarItem): string {
  const category = categoryLabel(item) || "未分类";
  const summary = item.summary.trim();
  return summary ? `可作为「${category}」资源沉淀。${summary}` : `可作为「${category}」资源沉淀，后续按来源继续复核。`;
}

export function resourceHighlightBullets(item: RadarItem): string[] {
  const bullets = cleanBulletList(item.highlights).slice(0, 3);
  if (bullets.length) return bullets;

  const facts = resourceFacts(item).slice(0, 2);
  return [`类型与分类已归入「${categoryLabel(item) || "未分类"}」。`, ...facts.map((fact) => `来源依据：${fact}。`)].slice(0, 3);
}

export function resourceUseCaseBullets(item: RadarItem): string[] {
  const bullets = cleanBulletList(item.useCases).slice(0, 3);
  if (bullets.length) return bullets;

  const topic = item.categoryPath?.[1] || item.categoryPath?.[0] || item.category || "当前工作流";
  return [`用于评估「${topic}」相关工具、技巧或案例是否值得继续试用。`];
}

export function resourceReviewBullets(item: RadarItem): string[] {
  const bullets = cleanBulletList(item.evidence).slice(0, 3);
  if (bullets.length) return bullets;

  const checks: string[] = [];
  if (item.analysisSource !== "ai" && item.analysisSource !== "mixed") {
    checks.push("当前主要来自本地规则，建议结合来源页面复核价值。");
  }
  if (!item.rawMetadata?.textSample && !item.rawMetadata?.description) {
    checks.push("缺少完整网页摘要，可重新解析以补充更多依据。");
  }
  if (!item.sourceUrl) {
    checks.push("缺少原始链接，建议补充出处后再长期收藏。");
  }
  if (checks.length === 0) checks.push("打开来源页面确认最新 README、演示地址和使用限制。");
  return checks.slice(0, 3);
}

export function metadataLinks(item: RadarItem): Array<{ label: string; url: string }> {
  const links = item.rawMetadata?.links;
  const normalizedLinks = Array.isArray(links)
    ? links
        .filter((link): link is { label: string; url: string } => {
          return typeof link.label === "string" && typeof link.url === "string" && /^https?:\/\//i.test(link.url);
        })
        .slice(0, 6)
    : [];
  const repoInfo = githubRepoInfo(item.sourceUrl);
  if (!repoInfo) return normalizedLinks;

  const fallbackLinks = [
    { label: "GitHub", url: repoInfo.url },
    { label: "README", url: `https://raw.githubusercontent.com/${repoInfo.owner}/${repoInfo.repo}/HEAD/README.md` }
  ];
  const seen = new Set(normalizedLinks.map((link) => link.url));
  for (const link of fallbackLinks) {
    if (!seen.has(link.url)) normalizedLinks.push(link);
  }
  return normalizedLinks.slice(0, 6);
}

export function sourcePreviewText(item: RadarItem): string {
  const metadataDescription = typeof item.rawMetadata?.description === "string" ? item.rawMetadata.description : "";
  const metadataSample = typeof item.rawMetadata?.textSample === "string" ? item.rawMetadata.textSample : "";
  return item.sourceText || metadataDescription || metadataSample || item.sourceUrl || "";
}

export function toReadableBlocks(value: string, fallback: string): string[] {
  const cleaned = value
    .replace(/\r\n/g, "\n")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_`>|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return [fallback];

  const sentences = cleaned.match(/[^。！？?!]+[。！？?!]?/g) ?? [cleaned];
  const blocks: string[] = [];
  let current = "";
  for (const sentence of sentences) {
    const part = sentence.trim();
    if (!part) continue;
    if ((current + part).length > 220 && current) {
      blocks.push(current.trim());
      current = "";
    }
    current += `${part} `;
    if (blocks.length >= 5) break;
  }
  if (current.trim() && blocks.length < 6) blocks.push(current.trim());
  const output = blocks.length > 0 ? blocks : [cleaned.slice(0, 420)];
  return output.map((block) => (block.length > 360 ? `${block.slice(0, 360).trim()}...` : block));
}

export function isResourceStatus(value: string): value is ResourceStatus {
  return ["inbox", "useful", "archived"].includes(value);
}

function cleanBulletList(values: string[] | undefined): string[] {
  return (values ?? []).map((value) => value.trim()).filter(Boolean);
}

function githubRepoInfo(sourceUrl: string | undefined): { fullName: string; owner: string; repo: string; url: string } | undefined {
  if (!sourceUrl) return undefined;
  const normalized = /^https?:\/\//i.test(sourceUrl) ? sourceUrl : `https://${sourceUrl}`;
  try {
    const url = new URL(normalized);
    if (!/github\.com$/i.test(url.hostname)) return undefined;
    const [owner, repoWithSuffix] = url.pathname.split("/").filter(Boolean);
    const repo = repoWithSuffix?.replace(/\.git$/i, "");
    if (!owner || !repo) return undefined;
    return {
      fullName: `${owner}/${repo}`,
      owner,
      repo,
      url: `https://github.com/${owner}/${repo}`
    };
  } catch {
    return undefined;
  }
}
