import type { SkillItem, SkillKind, TaxonomySource } from "./types.js";

export interface TaxonomyPatch {
  category: string;
  categoryPath: string[];
  taxonomySource: TaxonomySource;
}

const ZH = {
  fallback: "\u672a\u5206\u7c7b",
  tool: "\u5de5\u5177",
  article: "\u6559\u7a0b\u6587\u7ae0",
  frontend: "\u524d\u7aef\u5f00\u53d1",
  visual: "\u89c6\u89c9\u8bbe\u8ba1",
  video: "\u89c6\u9891\u526a\u8f91",
  ppt: "PPT\u751f\u6210",
  voice: "\u58f0\u97f3\u514b\u9686",
  threeD: "3D\u751f\u6210",
  predict: "\u9884\u6d4b\u6a21\u62df",
  agent: "\u667a\u80fd\u4f53\u5e94\u7528",
  knowledge: "\u77e5\u8bc6\u7ba1\u7406",
  office: "\u529e\u516c\u751f\u6210"
} as const;

const FALLBACK_CATEGORY = ZH.fallback;
const MAX_LEVELS = 2;

const GENERIC_CATEGORY_KEYS = new Set([
  "ai",
  "misc",
  "other",
  "resource",
  "resources",
  "tool",
  "tools",
  "unknown",
  "uncategorized",
  "\u5176\u4ed6",
  "\u5176\u5b83",
  "\u6848\u4f8b",
  "\u4ea7\u54c1\u6848\u4f8b",
  "\u8d44\u6e90",
  "\u8d44\u6e90\u5361\u7247",
  ZH.fallback,
  "\u672a\u77e5"
]);

const MAJOR_BY_KIND: Record<SkillKind, string> = {
  "skill-md": "Skills",
  "github-repo": ZH.tool,
  mcp: "MCP",
  prompt: "Prompt",
  workflow: "Workflow",
  demo: "Demo",
  tool: ZH.tool,
  article: ZH.article,
  unknown: FALLBACK_CATEGORY
};

const PREFERRED_TOPICS: ReadonlySet<string> = new Set<string>([
  ZH.frontend,
  ZH.visual,
  ZH.video,
  ZH.ppt,
  ZH.voice,
  ZH.threeD,
  ZH.predict,
  ZH.agent,
  ZH.knowledge,
  ZH.office
]);

const RESOURCE_MAJOR_CATEGORIES = new Set([ZH.tool, "Skills", "Demo", ZH.article, "Prompt", "MCP", "Workflow", FALLBACK_CATEGORY]);
const OPEN_SOURCE_MAJOR_KEYS = new Set(["\u5f00\u6e90\u9879\u76ee", "github", "repo", "repository", "open source", "opensource", "\u4ed3\u5e93"]);

export function majorCategoryForKind(kind: SkillKind): string {
  return MAJOR_BY_KIND[kind] ?? FALLBACK_CATEGORY;
}

export function deriveRuleCategoryPath(kind: SkillKind, haystack: string): string[] {
  const major = inferMajorCategory(kind, haystack);
  const topic = inferTopicCategory(haystack);
  if (topic && topic !== major) return [major, topic];
  return [major];
}

function inferMajorCategory(kind: SkillKind, haystack: string): string {
  if (kind !== "github-repo") return majorCategoryForKind(kind);
  if (/skill\.md|codex skill|cursor rule|claude skill|agent skill|skills?/i.test(haystack)) return "Skills";
  if (/\bmcp\b|model context protocol/i.test(haystack)) return "MCP";
  if (/\bprompt\b|\u63d0\u793a\u8bcd|system prompt|rules?/i.test(haystack)) return "Prompt";
  if (/workflow|\u5de5\u4f5c\u6d41|ci\/cd|pipeline|github actions/i.test(haystack)) return "Workflow";
  if (/demo|showcase|playground|live demo|pages\.dev|vercel\.app|\u793a\u4f8b|\u6f14\u793a/i.test(haystack)) return "Demo";
  if (/tutorial|article|blog|guide|docs|\u6559\u7a0b|\u6587\u7ae0|\u6307\u5357|\u6587\u6863/i.test(haystack)) return ZH.article;
  return ZH.tool;
}

function inferTopicCategory(haystack: string): string | undefined {
  if (/\u77ed\u89c6\u9891|\u89c6\u9891\u526a\u8f91|\u526a\u8f91\u5bfc\u51fa|\u5b57\u5e55|subtitle|caption|captions/i.test(haystack)) return ZH.video;
  if (/\u58f0\u97f3\u514b\u9686|\u8bed\u97f3\u514b\u9686|\u914d\u97f3|\u97f3\u8272|voice\s*(clone|cloning)|speech\s*synthesis|text[-\s]?to[-\s]?speech|\btts\b|audio\s*(clone|cloning|generation)/i.test(haystack)) return ZH.voice;
  if (/ppt|slide|presentation|deck|\u6f14\u793a\u6587\u7a3f|\u5e7b\u706f\u7247|\u8bfe\u4ef6/i.test(haystack)) return ZH.ppt;
  if (/3d|three\.?js|blender|asset generation|3d asset|\u4e09\u7ef4|\u6a21\u578b|\u8d44\u4ea7\u751f\u6210/i.test(haystack)) return ZH.threeD;
  if (/huashu|design|figma|visual design|poster|\u8bbe\u8ba1|\u6d77\u62a5|\u89c6\u89c9/i.test(haystack)) return ZH.visual;
  if (/predict|prediction|forecast|swarm intelligence|\u7fa4\u4f53\u667a\u80fd|\u9884\u6d4b\u4e07\u7269|\u9884\u6d4b|simulation|\u6a21\u62df/i.test(haystack)) return ZH.predict;
  if (/agent|multi-agent|agentic|\u667a\u80fd\u4f53|\u591a\u667a\u80fd\u4f53/i.test(haystack)) return ZH.agent;
  if (/frontend|\u524d\u7aef|vue|react|next|css|animation|animated|gsap|\u52a8\u6548|\u52a8\u753b|\u4ea4\u4e92|components?/i.test(haystack)) return ZH.frontend;
  if (/knowledge|knowledge graph|\u77e5\u8bc6\u5e93|\u77e5\u8bc6\u56fe\u8c31|\u6587\u6863\u95ee\u7b54|rag\b/i.test(haystack)) return ZH.knowledge;
  if (/office|\u529e\u516c|\u8868\u683c|\u6587\u6863|word|excel|notion/i.test(haystack)) return ZH.office;
  return undefined;
}

export function createTaxonomyPatch(
  input: { kind?: SkillKind; category?: string; categoryPath?: string[]; taxonomySource?: TaxonomySource },
  options: { fallbackCategory?: string; existingCategoryPaths?: string[][]; source?: TaxonomySource } = {}
): TaxonomyPatch {
  const fallback = options.fallbackCategory || (input.kind ? majorCategoryForKind(input.kind) : FALLBACK_CATEGORY);
  const rawPath = input.categoryPath?.length ? input.categoryPath : input.category ? splitLegacyCategory(input.category) : [fallback];
  const normalized = normalizeCategoryPath(rawPath, fallback, input.kind);
  const categoryPath = reuseExistingCategoryPath(normalized, options.existingCategoryPaths ?? []);
  return {
    category: categoryPath.join(" / "),
    categoryPath,
    taxonomySource: input.taxonomySource ?? options.source ?? "rules"
  };
}

export function normalizeResourceTaxonomy(item: SkillItem): SkillItem {
  return {
    ...item,
    ...createTaxonomyPatch(
      {
        kind: item.kind,
        category: item.category,
        categoryPath: item.categoryPath,
        taxonomySource: item.taxonomySource
      },
      { source: item.taxonomySource ?? "rules" }
    )
  };
}

export function categoryPathsFromItems(items: SkillItem[]): string[][] {
  const seen = new Set<string>();
  const paths: string[][] = [];
  for (const item of items) {
    const path = createTaxonomyPatch({ kind: item.kind, category: item.category, categoryPath: item.categoryPath }).categoryPath;
    const key = pathKey(path);
    if (seen.has(key)) continue;
    seen.add(key);
    paths.push(path);
  }
  return paths.sort((left, right) => left.join("/").localeCompare(right.join("/"), "zh-CN"));
}

function splitLegacyCategory(category: string): string[] {
  return category
    .split(/\s*(?:>|\u2192|\u2022|\|)\s*|\s+\/\s+/g)
    .map((part) => part.trim())
    .filter(Boolean);
}

function normalizeCategoryPath(path: string[], fallback: string, kind?: SkillKind): string[] {
  const normalized: string[] = [];
  for (const part of path.slice(0, MAX_LEVELS)) {
    const value = normalizeCategorySegment(part);
    if (!value) continue;
    if ((isGenericCategory(value) || isOpenSourceMajor(value)) && normalized.length === 0 && path.length > 1) continue;
    normalized.push(value);
  }

  const explicitMajor = normalized[0] ? normalizeResourceMajor(normalized[0]) : "";
  const kindMajor = kind ? majorCategoryForKind(kind) : "";
  const major =
    kind === "github-repo" && explicitMajor && ["MCP", "Prompt", "Workflow"].includes(explicitMajor)
      ? kindMajor
      : explicitMajor || kindMajor || normalizeResourceMajor(fallback) || FALLBACK_CATEGORY;
  const candidates = normalized.filter(
    (part) =>
      part !== major &&
      part !== fallback &&
      !isGenericCategory(part) &&
      !isOpenSourceMajor(part) &&
      !normalizeResourceMajor(part)
  );
  const minor = candidates.find((part) => PREFERRED_TOPICS.has(part)) ?? candidates[0];
  return minor ? [major, minor] : [major];
}

function normalizeCategorySegment(value: string): string {
  const normalized = value
    .normalize("NFKC")
    .replace(/[#"'\x60]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 40);
  return normalizeTopicAlias(normalized);
}

function isGenericCategory(value: string): boolean {
  return GENERIC_CATEGORY_KEYS.has(value.toLowerCase());
}

function normalizeResourceMajor(value: string): string {
  const normalized = value.trim();
  if (isOpenSourceMajor(normalized)) return "";
  if (/^skills?$/i.test(normalized) || normalized === "\u6280\u5de7") return "Skills";
  if (/^(tutorials?|articles?|docs?|guides?|\u6559\u7a0b|\u6587\u7ae0|\u6559\u7a0b\u6587\u7ae0|\u6559\u7a0b\/\u6587\u7ae0)$/i.test(normalized)) return ZH.article;
  for (const major of RESOURCE_MAJOR_CATEGORIES) {
    if (normalizedKey(major) === normalizedKey(normalized)) return major;
  }
  return "";
}

function isOpenSourceMajor(value: string): boolean {
  return OPEN_SOURCE_MAJOR_KEYS.has(normalizedKey(value)) || /^(open\s*source|github|repo|repository)$/i.test(value.trim());
}

function reuseExistingCategoryPath(path: string[], existingPaths: string[][]): string[] {
  const [major, minor] = path;
  const sameMajor = existingPaths.find((existing) => normalizedKey(existing[0] ?? "") === normalizedKey(major ?? ""));
  if (!sameMajor) return path;
  if (!minor) return [sameMajor[0]!];

  const sameMinor = existingPaths.find(
    (existing) =>
      normalizedKey(existing[0] ?? "") === normalizedKey(major ?? "") &&
      normalizedKey(existing[1] ?? "") === normalizedKey(minor)
  );
  return sameMinor ? sameMinor : [sameMajor[0]!, minor];
}

function pathKey(path: string[]): string {
  return path.map(normalizedKey).join("/");
}

function normalizedKey(value: string): string {
  return value.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function normalizeTopicAlias(value: string): string {
  if (/^(\u591a\u667a\u80fd\u4f53\u4eff\u771f|\u7fa4\u4f53\u667a\u80fd|\u9884\u6d4b|\u9884\u6d4b\u6a21\u62df|prediction|forecast)$/i.test(value)) return ZH.predict;
  if (/^(\u52a8\u753b\u4ea4\u4e92|\u524d\u7aef|\u524d\u7aef\u5f00\u53d1|react|vue|ui\u7ec4\u4ef6|\u7ec4\u4ef6\u5e93|web animation)$/i.test(value)) return ZH.frontend;
  if (/^(\u8bbe\u8ba1\u751f\u6210|\u89c6\u89c9\u8bbe\u8ba1|ui\u8bbe\u8ba1|\u54c1\u724c\u8bbe\u8ba1|\u6d77\u62a5\u8bbe\u8ba1)$/i.test(value)) return ZH.visual;
  if (/^(\u89c6\u9891|\u89c6\u9891\u526a\u8f91|\u5b57\u5e55\u751f\u6210|\u5b57\u5e55|\u77ed\u89c6\u9891)$/i.test(value)) return ZH.video;
  if (/^(\u8bed\u97f3|\u914d\u97f3|\u58f0\u97f3\u514b\u9686|\u8bed\u97f3\u514b\u9686|\u97f3\u8272\u514b\u9686)$/i.test(value)) return ZH.voice;
  if (/^(ppt|ppt\u751f\u6210|ppt \u751f\u6210|\u5e7b\u706f\u7247|\u6f14\u793a\u6587\u7a3f|\u8bfe\u4ef6\u751f\u6210)$/i.test(value)) return ZH.ppt;
  if (/^(3d\u751f\u6210|3d \u751f\u6210|3d\u8d44\u4ea7\u751f\u6210|3d \u8d44\u4ea7\u751f\u6210|\u4e09\u7ef4\u751f\u6210|\u8d44\u4ea7\u751f\u6210|3d asset|asset generation)$/i.test(value)) return ZH.threeD;
  if (/^(\u667a\u80fd\u4f53|agent|agentic|\u591a\u667a\u80fd\u4f53)$/i.test(value)) return ZH.agent;
  if (/^(\u77e5\u8bc6\u5e93|\u77e5\u8bc6\u56fe\u8c31|rag|\u6587\u6863\u95ee\u7b54|\u77e5\u8bc6\u7ba1\u7406)$/i.test(value)) return ZH.knowledge;
  return value;
}
