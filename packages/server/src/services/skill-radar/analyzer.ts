import crypto from "node:crypto";
import type { AnalysisSource, ResourceMetadata, SkillCreateInput, SkillItem, SkillKind } from "./types.js";
import { createTaxonomyPatch, deriveRuleCategoryPath } from "./taxonomy.js";

interface Frontmatter {
  name?: string;
  description?: string;
  tags: string[];
}

interface Analysis {
  title: string;
  kind: SkillKind;
  category: string;
  categoryPath: string[];
  tags: string[];
  taxonomySource: "rules";
  confidence: number;
  summary: string;
  highlights?: string[];
  useCases?: string[];
  evidence?: string[];
}

const TAG_KEYWORDS: Array<[string, RegExp]> = [
  ["codex", /\bcodex\b/i],
  ["cursor", /\bcursor\b/i],
  ["claude", /\bclaude\b|anthropic/i],
  ["github", /github\.com|github actions|github/i],
  ["mcp", /\bmcp\b|model context protocol/i],
  ["prompt", /\bprompt\b|提示词|system prompt/i],
  ["workflow", /workflow|工作流|ci\/cd|pipeline/i],
  ["demo", /demo|playground|preview|演示|示例|pages\.dev|vercel\.app|netlify\.app/i],
  ["tool", /\btool\b|工具|dashboard|console|platform|平台/i],
  ["vue", /\bvue\b|vite/i],
  ["react", /\breact\b|next\.js|nextjs/i],
  ["python", /\bpython\b|flask|fastapi|django/i],
  ["design", /design|ui|ux|视觉|样式|gsap|animation/i],
  ["agent", /\bagent\b|智能体|multi-agent|skills?/i]
];

export interface AnalyzeSkillOptions {
  metadata?: ResourceMetadata;
  analysisSource?: AnalysisSource;
  analysisError?: string;
}

export function analyzeSkillInput(input: Partial<SkillCreateInput>, options: AnalyzeSkillOptions = {}): SkillItem {
  const now = new Date().toISOString();
  const sourceUrl = normalizeUrl(input.sourceUrl ?? "");
  const sourceText = (input.sourceText ?? "").trim();
  const analysisSourceText = /<[^>]+>/.test(sourceText) ? cleanMetadataValue(sourceText) : sourceText;
  const analysisText = mergeMetadataText(analysisSourceText, options.metadata);
  const analysis = analyze({ sourceUrl, sourceText: analysisText });

  return {
    id: createSkillId(sourceUrl || sourceText),
    title: analysis.title,
    sourceUrl: sourceUrl || undefined,
    sourceText: sourceText || undefined,
    kind: analysis.kind,
    category: analysis.category,
    categoryPath: analysis.categoryPath,
    taxonomySource: analysis.taxonomySource,
    tags: analysis.tags,
    status: "inbox",
    confidence: analysis.confidence,
    summary: analysis.summary,
    highlights: analysis.highlights,
    useCases: analysis.useCases,
    evidence: buildEvidence(options.metadata, analysis.evidence),
    previewImageUrl: options.metadata?.imageUrl ?? options.metadata?.images?.[0]?.url,
    createdAt: now,
    updatedAt: now,
    analysisSource: options.analysisSource ?? (options.metadata ? "metadata" : "rules"),
    sourceFetchedAt: options.metadata ? now : undefined,
    analysisError: options.analysisError,
    rawMetadata: options.metadata
  };
}

function mergeMetadataText(sourceText: string, metadata: ResourceMetadata | undefined): string {
  if (!metadata) return sourceText;
  return [
    metadata.title ? `# ${cleanMetadataValue(metadata.title)}` : "",
    metadata.description ? cleanMetadataValue(metadata.description) : "",
    metadata.repository?.description ? cleanMetadataValue(metadata.repository.description) : "",
    metadata.textSample ? cleanMetadataValue(metadata.textSample) : "",
    sourceText
  ]
    .filter(Boolean)
    .join("\n\n");
}

function cleanMetadataValue(value: string): string {
  return value
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function analyze(input: { sourceUrl: string; sourceText: string }): Analysis {
  const frontmatter = parseFrontmatter(input.sourceText);
  const haystack = `${input.sourceUrl}\n${input.sourceText}`;
  const kind = detectKind(input.sourceUrl, input.sourceText, frontmatter);
  const taxonomy = createTaxonomyPatch({ kind, categoryPath: deriveRuleCategoryPath(kind, haystack) }, { source: "rules" });
  const tags = normalizeTags([...frontmatter.tags, ...extractKeywordTags(haystack), sourceTag(kind)]);
  const title = inferTitle(input.sourceUrl, input.sourceText, frontmatter, kind);
  const summary = inferSummary(input.sourceText, frontmatter, input.sourceUrl, kind);
  const confidence = confidenceFor(kind, input.sourceUrl, input.sourceText, frontmatter);
  const highlights = inferHighlights(kind, input.sourceText);
  const useCases = inferUseCases(input.sourceText);
  const evidence = inferEvidence(input.sourceUrl, input.sourceText);
  return {
    title,
    kind,
    category: taxonomy.category,
    categoryPath: taxonomy.categoryPath,
    taxonomySource: "rules",
    tags,
    confidence,
    summary,
    highlights,
    useCases,
    evidence
  };
}

function detectKind(sourceUrl: string, sourceText: string, frontmatter: Frontmatter): SkillKind {
  const text = `${sourceUrl}\n${sourceText}`;
  if (
    frontmatter.name ||
    /(^|\n)#\s*SKILL\.md\b/i.test(sourceText) ||
    /(^|\n)description:\s*/i.test(sourceText) ||
    /skill\.md|codex skill|cursor rule|claude skill|agent skill|\/skills?(?:[/?#\s]|$)/i.test(text)
  ) {
    return "skill-md";
  }
  if (/github\.com/i.test(sourceUrl)) return "tool";
  if (isDemoUrl(sourceUrl) || /\bdemo\b|playground|preview|演示|示例/i.test(text)) return "demo";
  if (/\bmcp\b|model context protocol/i.test(text)) return "mcp";
  if (/\bprompt\b|提示词|system prompt|rules?/i.test(text)) return "prompt";
  if (/workflow|工作流|ci\/cd|pipeline|github actions/i.test(text)) return "workflow";
  if (/\btool\b|工具|dashboard|console|platform|平台|library|sdk|app/i.test(text)) return "tool";
  if (/tutorial|article|blog|guide|教程|文章|指南|文档/i.test(text)) return "article";
  if (/^https?:\/\//i.test(sourceUrl)) return "article";
  return "unknown";
}

function sourceTag(kind: SkillKind): string {
  if (kind === "github-repo") return "github";
  if (kind === "skill-md") return "skill";
  return kind;
}

function confidenceFor(kind: SkillKind, sourceUrl: string, sourceText: string, frontmatter: Frontmatter): number {
  if (frontmatter.name && frontmatter.description) return 94;
  if (kind === "skill-md") return 88;
  if (/github\.com\/[^/]+\/[^/\s]+/i.test(sourceUrl)) return 78;
  if (kind === "demo" && /^https?:\/\//i.test(sourceUrl)) return 74;
  if (kind === "tool" && /^https?:\/\//i.test(sourceUrl)) return 72;
  if (kind !== "unknown" && sourceText.length > 160) return 70;
  if (kind !== "unknown") return 62;
  return Math.min(58, Math.max(32, Math.floor(sourceText.length / 20) + 32));
}

function inferTitle(sourceUrl: string, sourceText: string, frontmatter: Frontmatter, kind: SkillKind): string {
  if (frontmatter.name) return cleanTitle(frontmatter.name);
  const repoTitle = sourceUrl.match(/github\.com\/([^/]+)\/([^/?#\s]+)/i);
  if (repoTitle) return cleanTitle(repoTitle[2].replace(/\.git$/i, ""));
  const h1 = sourceText.match(/^#\s+(.+)$/m)?.[1];
  if (h1) return cleanTitle(h1);
  const firstLine = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0 && !line.startsWith("---"));
  if (firstLine && firstLine.length <= 120) return cleanTitle(firstLine);
  try {
    const url = new URL(sourceUrl);
    const name = url.pathname.split("/").filter(Boolean).pop() || url.hostname.split(".")[0] || url.hostname;
    return cleanTitle(name.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " "));
  } catch {
    return kind === "unknown" ? "未命名资源" : `${kind} resource`;
  }
}

function inferSummary(sourceText: string, frontmatter: Frontmatter, sourceUrl: string, kind: SkillKind): string {
  if (frontmatter.description) return trimText(frontmatter.description, 220);
  const paragraph = sourceText
    .replace(/^---[\s\S]*?---/, "")
    .split(/\n\s*\n/)
    .map((block) => block.replace(/^#+\s*/gm, "").trim())
    .find((block) => block.length > 24);
  if (paragraph) return trimText(paragraph.replace(/\s+/g, " "), 260);
  if (sourceUrl && kind === "demo") return `来自 ${sourceUrl} 的在线演示资源，适合评估产品交互、视觉表达和可复用工作流。`;
  if (sourceUrl && kind === "tool") return `来自 ${sourceUrl} 的工具线索，适合评估核心能力、适用场景和落地方式。`;
  if (sourceUrl) return `来自 ${sourceUrl} 的资源线索，已进入资源库等待复核。`;
  return "从粘贴文本创建的资源线索，建议补充来源、用途和适用场景。";
}

function inferHighlights(kind: SkillKind, sourceText: string): string[] | undefined {
  const text = sourceText.replace(/\s+/g, " ");
  const highlights: string[] = [];
  const candidates: Array<[RegExp, string]> = [
    [/\breact\b|vue|next\.?js|组件|component/i, "包含前端开发或组件相关能力。"],
    [/animation|motion|gsap|动效|动画|交互/i, "重点涉及动效、交互或视觉表达。"],
    [/3d|three\.?js|模型|生成|asset/i, "涉及 3D、生成式资产或可视化能力。"],
    [/agent|智能体|multi-agent|workflow|工作流/i, "包含智能体或工作流组织方式。"],
    [/demo|playground|preview|演示|示例/i, "有可直接观察的演示或案例入口。"]
  ];
  for (const [pattern, label] of candidates) {
    if (pattern.test(text)) highlights.push(label);
    if (highlights.length >= 3) break;
  }
  if (kind === "github-repo") highlights.unshift("来自 GitHub 仓库，可结合 README 和仓库元数据判断价值。");
  return highlights.length > 0 ? uniqueText(highlights).slice(0, 4) : undefined;
}

function inferUseCases(sourceText: string): string[] | undefined {
  const text = sourceText.replace(/\s+/g, " ");
  const useCases: string[] = [];
  const candidates: Array<[RegExp, string]> = [
    [/react|vue|next|组件|前端/i, "前端开发参考"],
    [/design|ui|视觉|样式|动效|动画/i, "视觉设计与交互灵感"],
    [/ppt|slide|presentation|演示文稿/i, "办公内容生成"],
    [/video|字幕|剪辑|短视频/i, "视频内容生产"],
    [/voice|声音|语音|克隆/i, "音频或声音处理"],
    [/agent|workflow|自动化|智能体/i, "AI 工作流沉淀"]
  ];
  for (const [pattern, label] of candidates) {
    if (pattern.test(text)) useCases.push(label);
    if (useCases.length >= 3) break;
  }
  return useCases.length > 0 ? uniqueText(useCases) : undefined;
}

function inferEvidence(sourceUrl: string, sourceText: string): string[] | undefined {
  const evidence: string[] = [];
  if (/github\.com\/[^/]+\/[^/\s]+/i.test(sourceUrl)) evidence.push("来源是 GitHub 仓库链接。");
  if (/demo|playground|pages\.dev|vercel\.app|netlify\.app/i.test(sourceUrl)) evidence.push("来源包含可访问的演示或预览地址。");
  const firstSentence = sourceText
    .replace(/\s+/g, " ")
    .split(/[。！？?!]/)
    .map((item) => item.trim())
    .find((item) => item.length >= 18 && item.length <= 180);
  if (firstSentence) evidence.push(firstSentence);
  return evidence.length > 0 ? uniqueText(evidence).slice(0, 4) : undefined;
}

function buildEvidence(metadata: ResourceMetadata | undefined, ruleEvidence: string[] | undefined): string[] | undefined {
  const evidence = [...(ruleEvidence ?? [])];
  if (metadata?.repository?.language) evidence.push(`主要语言：${metadata.repository.language}`);
  if (typeof metadata?.repository?.stars === "number") evidence.push(`GitHub Stars：${metadata.repository.stars}`);
  if (metadata?.description) evidence.push(metadata.description);
  if (metadata?.images?.length) evidence.push(`已抓取 ${metadata.images.length} 张页面或 README 图像。`);
  else if (metadata?.imageUrl) evidence.push("已抓取页面预览图。");
  return uniqueText(evidence.map((item) => trimText(cleanMetadataValue(item), 180)).filter(Boolean)).slice(0, 5);
}

function uniqueText(items: string[]): string[] {
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of items) {
    const normalized = item.trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    output.push(normalized);
  }
  return output;
}

function isDemoUrl(sourceUrl: string): boolean {
  if (!sourceUrl) return false;
  try {
    const url = new URL(sourceUrl);
    return (
      /(^|\.)pages\.dev$/i.test(url.hostname) ||
      /(^|\.)vercel\.app$/i.test(url.hostname) ||
      /(^|\.)netlify\.app$/i.test(url.hostname) ||
      /(^|\.)github\.io$/i.test(url.hostname) ||
      /\bdemo\b|playground|preview/i.test(url.hostname + url.pathname)
    );
  } catch {
    return /\bdemo\b|pages\.dev|vercel\.app|netlify\.app|github\.io/i.test(sourceUrl);
  }
}

function parseFrontmatter(sourceText: string): Frontmatter {
  const match = sourceText.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!match) return { tags: [] };
  const body = match[1] ?? "";
  const name = readYamlScalar(body, "name");
  const description = readYamlScalar(body, "description");
  const tags = readYamlList(body, "tags");
  return { name, description, tags };
}

function readYamlScalar(body: string, key: string): string | undefined {
  const value = body.match(new RegExp(`^${key}:\\s*(.+)$`, "im"))?.[1]?.trim();
  return value ? stripQuotes(value) : undefined;
}

function readYamlList(body: string, key: string): string[] {
  const inline = body.match(new RegExp(`^${key}:\\s*\\[(.+)]`, "im"))?.[1];
  if (inline) return inline.split(",").map((item) => stripQuotes(item.trim()));
  const block = body.match(new RegExp(`^${key}:\\s*\\r?\\n((?:\\s*-\\s*.+\\r?\\n?)+)`, "im"))?.[1] ?? "";
  return block
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*-\s*(.+)$/)?.[1])
    .filter((value): value is string => Boolean(value))
    .map((value) => stripQuotes(value.trim()));
}

function extractKeywordTags(text: string): string[] {
  return TAG_KEYWORDS.flatMap(([tag, pattern]) => (pattern.test(text) ? [tag] : []));
}

function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const value = tag
      .toLowerCase()
      .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= 6) break;
  }
  return normalized;
}

function cleanTitle(title: string): string {
  return trimText(stripQuotes(title).replace(/\s+/g, " ").trim(), 96);
}

function trimText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3).trim()}...`;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

function normalizeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return "";
  try {
    const url = new URL(trimmed);
    return url.toString();
  } catch {
    return trimmed;
  }
}

function createSkillId(seed: string): string {
  return crypto.createHash("sha1").update(`${Date.now()}:${seed}`).digest("hex").slice(0, 16);
}
