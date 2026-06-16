import { z } from "zod";
import type { AiSettings } from "../../store.js";
import {
  categoryPathSchema,
  resourceLanguageSchema,
  resourceOutputLocaleSchema,
  skillKindSchema,
  taxonomySourceSchema,
  type SkillItem
} from "./types.js";
import { createTaxonomyPatch, majorCategoryForKind } from "./taxonomy.js";

const DEFAULT_AI_TIMEOUT_MS = 60_000;
const MIN_AI_TIMEOUT_MS = 10_000;
const MAX_AI_TIMEOUT_MS = 180_000;
const DEFAULT_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_MODEL = "gpt-4o-mini";
const MAX_AI_SOURCE_TEXT = 1_200;
const MAX_AI_METADATA_TEXT = 1_800;
const MAX_AI_IMAGES = 6;
const MAX_AI_LINKS = 6;
const MAX_AI_EXISTING_CATEGORIES = 24;

type RawResourceMetadata = NonNullable<SkillItem["rawMetadata"]>;

const aiAnalysisSchema = z.object({
  title: z.string().min(1).max(160),
  kind: skillKindSchema,
  category: z.string().min(1).max(80),
  categoryPath: categoryPathSchema.optional(),
  taxonomySource: taxonomySourceSchema.optional(),
  tags: z.array(z.string().min(1).max(40)).max(10),
  summary: z.string().min(1).max(900),
  highlights: z.array(z.string().min(1).max(180)).max(5).optional(),
  useCases: z.array(z.string().min(1).max(180)).max(5).optional(),
  evidence: z.array(z.string().min(1).max(220)).max(6).optional(),
  previewImageUrl: z.string().optional(),
  confidence: z.number().int().min(0).max(100),
  language: resourceLanguageSchema.optional(),
  outputLocale: resourceOutputLocaleSchema.optional()
});

export type AiAnalysisPatch = z.infer<typeof aiAnalysisSchema>;

export interface AiAnalysisResult {
  patch?: AiAnalysisPatch;
  error?: string;
  configured: boolean;
}

export interface AiConnectionTestResult {
  ok: boolean;
  providerId: string;
  baseUrl: string;
  model: string;
  latencyMs: number;
  error?: string;
}

export async function analyzeResourceWithAi(
  item: SkillItem,
  settings?: AiSettings,
  options: { existingCategoryPaths?: string[][] } = {}
): Promise<AiAnalysisResult> {
  const runtime = resolveAiRuntimeSettings(settings);
  if (!runtime.apiKey) return { configured: false, error: "未配置 AI Key，当前使用本地规则解析。" };

  try {
    const aiInput = buildAiResourceInput(item, options.existingCategoryPaths ?? [], runtime.outputLocale);
    const response = await requestChatCompletion(runtime, {
      temperature: 0.2,
      max_tokens: 900,
      messages: [
        {
          role: "system",
          content: [
            "You classify AI development resources for a local desktop app.",
            "Return only strict JSON with title, kind, category, categoryPath, taxonomySource, tags, summary, highlights, useCases, evidence, previewImageUrl, confidence, language, outputLocale.",
            "categoryPath must contain one or two labels: [resource form, topic].",
            "The first label must be one of: 工具, Skills, Demo, 教程文章, Prompt, MCP, Workflow, 未分类.",
            "Do not use GitHub, repository, open source, 开源项目, 仓库 as the first label. Put those in tags/source only.",
            "Do not use github-repo as kind just because the source is GitHub. Classify the actual resource as tool, skill-md, demo, prompt, workflow, mcp, article, or unknown.",
            "The second label is the concrete use case, for example 前端开发, 视觉设计, 视频剪辑, PPT生成, 声音克隆, 3D生成, 预测模拟, 知识管理.",
            "Prefer existing second-level topics when they fit. Create a new topic only when none match.",
            "Avoid generic topics like AI, tool, resources, other, misc, unknown.",
            "Return no more than 6 tags.",
            "highlights are 2-4 concise value points. useCases are 1-4 practical scenarios. evidence must cite facts from metadata/source text, not guesses.",
            "If metadata includes imageUrl, keep it as previewImageUrl unless it is clearly irrelevant.",
            "Do not include markdown.",
            languageInstruction(runtime.outputLocale)
          ].join(" ")
        },
        {
          role: "user",
          content: JSON.stringify(aiInput)
        }
      ]
    });

    if (!response.ok) return { configured: true, error: await readAiHttpError(response) };
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) return { configured: true, error: "AI 没有返回可解析内容。" };
    const parsedJson = normalizeAiAnalysisPayload(parseJsonContent(content), item, runtime.outputLocale);
    if (!parsedJson) return { configured: true, error: invalidAiSchemaMessage() };
    const parsed = aiAnalysisSchema.safeParse(parsedJson);
    if (!parsed.success) return { configured: true, error: invalidAiSchemaMessage() };
    const taxonomy = createTaxonomyPatch(parsed.data, {
      fallbackCategory: item.category,
      existingCategoryPaths: options.existingCategoryPaths,
      source: "ai"
    });
    return { configured: true, patch: { ...parsed.data, ...taxonomy } };
  } catch (error) {
    return { configured: true, error: readableAiException(error, timeoutAiAnalysisMessage(runtime.timeoutMs)) };
  }
}

function invalidAiSchemaMessage(): string {
  return "AI 返回结构不符合资源卡片 schema，已使用规则预览。";
}

function buildAiResourceInput(item: SkillItem, existingCategoryPaths: string[][], outputLocale: "zh-CN" | "en-US" | "source"): Record<string, unknown> {
  return {
    sourceUrl: item.sourceUrl,
    sourceText: item.sourceText ? trimForSchema(item.sourceText, MAX_AI_SOURCE_TEXT) : undefined,
    metadata: compactAiMetadata(item.rawMetadata),
    current: {
      title: item.title,
      kind: item.kind,
      category: item.category,
      categoryPath: item.categoryPath,
      tags: item.tags.slice(0, 8),
      summary: trimForSchema(item.summary, 500),
      confidence: item.confidence
    },
    existingCategoryPaths: compactCategoryPaths(existingCategoryPaths),
    majorCategories: ["工具", "Skills", "Demo", "教程文章", "Prompt", "MCP", "Workflow", "未分类"],
    outputLocale,
    allowedKinds: ["skill-md", "mcp", "prompt", "workflow", "demo", "tool", "article", "unknown"]
  };
}

function compactAiMetadata(metadata: SkillItem["rawMetadata"]): Record<string, unknown> | undefined {
  if (!metadata) return undefined;
  return removeUndefined({
    title: trimOptional(metadata.title, 160),
    description: trimOptional(metadata.description, 500),
    siteName: trimOptional(metadata.siteName, 80),
    fetchedUrl: trimOptional(metadata.fetchedUrl, 1_200),
    imageUrl: trimOptional(metadata.imageUrl, 1_200),
    textSample: trimOptional(metadata.textSample, MAX_AI_METADATA_TEXT),
    images: compactAiImages(metadata.images),
    links: compactAiLinks(metadata.links),
    repository: compactAiRepository(metadata.repository)
  });
}

function compactAiRepository(repository: RawResourceMetadata["repository"]): Record<string, unknown> | undefined {
  if (!repository) return undefined;
  return removeUndefined({
    owner: trimOptional(repository.owner, 80),
    name: trimOptional(repository.name, 120),
    fullName: trimOptional(repository.fullName, 160),
    description: trimOptional(repository.description, 500),
    language: trimOptional(repository.language, 80),
    stars: repository.stars,
    forks: repository.forks,
    topics: repository.topics?.slice(0, 8).map((topic) => trimForSchema(topic, 40)),
    homepage: trimOptional(repository.homepage, 1_200),
    license: trimOptional(repository.license, 80),
    pushedAt: trimOptional(repository.pushedAt, 80)
  });
}

function compactAiImages(images: RawResourceMetadata["images"]): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(images)) return undefined;
  const output = images
    .slice(0, MAX_AI_IMAGES)
    .map((image) =>
      removeUndefined({
        label: trimOptional(image.label, 60),
        url: trimOptional(image.url, 1_200),
        source: trimOptional(image.source, 40)
      })
    )
    .filter((image) => image.url);
  return output.length > 0 ? output : undefined;
}

function compactAiLinks(links: RawResourceMetadata["links"]): Array<Record<string, unknown>> | undefined {
  if (!Array.isArray(links)) return undefined;
  const output = links
    .slice(0, MAX_AI_LINKS)
    .map((link) =>
      removeUndefined({
        label: trimOptional(link.label, 80),
        url: trimOptional(link.url, 1_200)
      })
    )
    .filter((link) => link.url);
  return output.length > 0 ? output : undefined;
}

function compactCategoryPaths(paths: string[][]): string[][] {
  const seen = new Set<string>();
  const output: string[][] = [];
  for (const path of paths) {
    const compact = path.slice(0, 2).map((part) => trimForSchema(part, 40)).filter(Boolean);
    if (!compact.length) continue;
    const key = compact.join("/");
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(compact);
    if (output.length >= MAX_AI_EXISTING_CATEGORIES) break;
  }
  return output;
}

function trimOptional(value: string | undefined, maxLength: number): string | undefined {
  if (!value) return undefined;
  const trimmed = trimForSchema(value, maxLength);
  return trimmed || undefined;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined && entry !== "")) as T;
}

function normalizeAiAnalysisPayload(raw: unknown, fallback: SkillItem, outputLocale: "zh-CN" | "en-US" | "source"): unknown {
  const data = unwrapAiObject(raw);
  if (!data) return undefined;
  const hasRecognizedField = [
    "title",
    "name",
    "kind",
    "type",
    "resourceType",
    "category",
    "categoryPath",
    "category_path",
    "categories",
    "tags",
    "summary",
    "description",
    "highlights",
    "useCases",
    "use_cases",
    "evidence",
    "previewImageUrl",
    "preview_image_url",
    "confidence",
    "score"
  ].some((key) => Object.prototype.hasOwnProperty.call(data, key));
  if (!hasRecognizedField) return undefined;

  const kind = normalizeAiKind(stringValue(data.kind) || stringValue(data.type) || stringValue(data.resourceType), fallback.kind);
  const categoryPath = normalizeAiCategoryPath(data.categoryPath ?? data.category_path ?? data.categories ?? data.category, fallback, kind);
  const category = categoryPath.join(" / ") || stringValue(data.category) || fallback.category;
  return {
    title: trimForSchema(stringValue(data.title) || stringValue(data.name) || fallback.title, 160),
    kind,
    category: trimForSchema(category, 80),
    categoryPath,
    taxonomySource: "ai",
    tags: normalizeAiTags(data.tags, fallback.tags),
    summary: trimForSchema(stringValue(data.summary) || stringValue(data.description) || fallback.summary, 900),
    highlights: normalizeAiStringArray(data.highlights, fallback.highlights, 5, 180),
    useCases: normalizeAiStringArray(data.useCases ?? data.use_cases, fallback.useCases, 5, 180),
    evidence: normalizeAiStringArray(data.evidence, fallback.evidence, 6, 220),
    previewImageUrl: normalizeAiUrl(stringValue(data.previewImageUrl) || stringValue(data.preview_image_url) || fallback.previewImageUrl),
    confidence: normalizeAiConfidence(data.confidence ?? data.score, fallback.confidence),
    language: normalizeAiLanguage(stringValue(data.language), fallback.language),
    outputLocale
  };
}

function unwrapAiObject(raw: unknown): Record<string, unknown> | undefined {
  if (!isRecord(raw)) return undefined;
  for (const key of ["resource", "card", "item", "data", "result"]) {
    const nested = raw[key];
    if (isRecord(nested)) return nested;
  }
  return raw;
}

function normalizeAiKind(value: string, fallback: SkillItem["kind"]): SkillItem["kind"] {
  const normalized = value.trim().toLowerCase().replace(/_/g, "-");
  if (/repo|github|repository/.test(normalized)) return "tool";
  if (skillKindSchema.options.includes(normalized as SkillItem["kind"]) && normalized !== "github-repo") return normalized as SkillItem["kind"];
  if (/demo|showcase|playground|case/.test(normalized)) return "demo";
  if (/tool|app|product|website/.test(normalized)) return "tool";
  if (/skill/.test(normalized)) return "skill-md";
  if (/prompt/.test(normalized)) return "prompt";
  if (/workflow|flow/.test(normalized)) return "workflow";
  if (/mcp/.test(normalized)) return "mcp";
  if (/article|tutorial|blog|doc/.test(normalized)) return "article";
  return fallback === "github-repo" ? "tool" : fallback;
}

function normalizeAiCategoryPath(value: unknown, fallback: SkillItem, kind: SkillItem["kind"]): string[] {
  const raw = Array.isArray(value)
    ? value.map((item) => stringValue(item))
    : typeof value === "string"
      ? value.split(/[>→|,/，、\s]+/g)
      : fallback.categoryPath ?? [fallback.category];
  const cleaned = raw.map((item) => trimForSchema(stringValue(item), 40)).filter(Boolean);
  return createTaxonomyPatch(
    {
      kind,
      categoryPath: cleaned.length > 0 ? cleaned : undefined,
      category: typeof value === "string" ? value : undefined
    },
    { fallbackCategory: majorCategoryForKind(kind), source: "ai" }
  ).categoryPath;
}

function normalizeAiTags(value: unknown, fallback: string[]): string[] {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，、\s]+/g) : fallback;
  const seen = new Set<string>();
  const tags: string[] = [];
  for (const item of raw) {
    const tag = stringValue(item)
      .toLowerCase()
      .replace(/^#/, "")
      .replace(/[^a-z0-9\u4e00-\u9fa5-]+/g, "-")
      .replace(/^-+|-+$/g, "");
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);
    tags.push(trimForSchema(tag, 40));
    if (tags.length >= 6) break;
  }
  return tags.length > 0 ? tags : fallback.slice(0, 6);
}

function normalizeAiConfidence(value: unknown, fallback: number): number {
  const numeric = typeof value === "number" ? value : Number(stringValue(value).replace(/%$/, ""));
  if (!Number.isFinite(numeric)) return fallback;
  return Math.max(0, Math.min(100, Math.round(numeric)));
}

function normalizeAiStringArray(value: unknown, fallback: string[] | undefined, maxItems: number, maxLength: number): string[] | undefined {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? value.split(/\n|[;；]/g) : fallback ?? [];
  const seen = new Set<string>();
  const output: string[] = [];
  for (const item of raw) {
    const text = trimForSchema(stringValue(item), maxLength);
    if (!text || seen.has(text)) continue;
    seen.add(text);
    output.push(text);
    if (output.length >= maxItems) break;
  }
  return output.length > 0 ? output : undefined;
}

function normalizeAiUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch {
    return undefined;
  }
}

function normalizeAiLanguage(value: string, fallback: SkillItem["language"]): SkillItem["language"] {
  if (value === "zh-CN" || value === "en-US" || value === "mixed" || value === "unknown") return value;
  return fallback;
}

function trimForSchema(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length <= maxLength ? normalized : `${normalized.slice(0, maxLength - 1).trim()}…`;
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export async function testAiConnection(settings?: AiSettings): Promise<AiConnectionTestResult> {
  const runtime = resolveAiRuntimeSettings(settings);
  const startedAt = Date.now();
  const baseResult = {
    providerId: runtime.providerId,
    baseUrl: normalizeBaseUrl(runtime.baseUrl),
    model: runtime.model
  };

  if (!runtime.apiKey) return { ...baseResult, ok: false, latencyMs: 0, error: "未配置 API Key。" };

  try {
    const response = await requestChatCompletion(runtime, {
      temperature: 0,
      max_tokens: 8,
      messages: [
        { role: "system", content: "Reply with OK." },
        { role: "user", content: "Connection test. Reply with OK." }
      ]
    });
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) return { ...baseResult, ok: false, latencyMs, error: await readAiHttpError(response) };
    return { ...baseResult, ok: true, latencyMs };
  } catch (error) {
    return { ...baseResult, ok: false, latencyMs: Date.now() - startedAt, error: readableAiException(error, "AI 连接测试超时，请检查端点或稍后重试。") };
  }
}

function resolveAiRuntimeSettings(settings?: AiSettings): {
  apiKey: string;
  baseUrl: string;
  model: string;
  providerId: string;
  outputLocale: "zh-CN" | "en-US" | "source";
  timeoutMs: number;
} {
  return {
    apiKey: process.env.DEV_COCKPIT_AI_API_KEY?.trim() || settings?.apiKey?.trim() || "",
    baseUrl: process.env.DEV_COCKPIT_AI_BASE_URL?.trim() || settings?.baseUrl?.trim() || DEFAULT_BASE_URL,
    model: process.env.DEV_COCKPIT_AI_MODEL?.trim() || settings?.model?.trim() || DEFAULT_MODEL,
    providerId: process.env.DEV_COCKPIT_AI_PROVIDER_ID?.trim() || settings?.providerId?.trim() || "custom",
    outputLocale: settings?.outputLocale ?? "zh-CN",
    timeoutMs: parseAiTimeoutMs(process.env.DEV_COCKPIT_AI_TIMEOUT_MS)
  };
}

function parseAiTimeoutMs(raw: string | undefined): number {
  if (!raw?.trim()) return DEFAULT_AI_TIMEOUT_MS;
  const parsed = Number(raw.trim());
  if (!Number.isFinite(parsed)) return DEFAULT_AI_TIMEOUT_MS;
  return Math.max(MIN_AI_TIMEOUT_MS, Math.min(MAX_AI_TIMEOUT_MS, Math.round(parsed)));
}

function timeoutAiAnalysisMessage(timeoutMs: number): string {
  return `AI 增强超过 ${Math.round(timeoutMs / 1000)} 秒未返回，已保留本地规则生成的资源卡。可稍后重试解析。`;
}

function languageInstruction(outputLocale: "zh-CN" | "en-US" | "source"): string {
  if (outputLocale === "en-US") return "Write title, categoryPath, tags, and summary in English. Preserve original product and repository names.";
  if (outputLocale === "source") return "Use the source language when obvious; otherwise use English. Preserve original product and repository names.";
  return "Write title, categoryPath, tags, and summary in Simplified Chinese. Preserve original product and repository names.";
}

async function requestChatCompletion(
  runtime: { apiKey: string; baseUrl: string; model: string; timeoutMs: number },
  body: { messages: Array<{ role: "system" | "user"; content: string }>; temperature: number; max_tokens?: number }
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), runtime.timeoutMs);
  try {
    return await fetch(`${normalizeBaseUrl(runtime.baseUrl)}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        authorization: `Bearer ${runtime.apiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: runtime.model,
        ...body
      })
    });
  } finally {
    clearTimeout(timer);
  }
}

function normalizeBaseUrl(value: string): string {
  return value.trim().replace(/\/+$/g, "");
}

function parseJsonContent(content: string): unknown {
  const trimmed = content.trim();
  if (trimmed.startsWith("{")) return JSON.parse(trimmed);
  const match = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (match?.[1]) return JSON.parse(match[1]);
  const objectMatch = trimmed.match(/\{[\s\S]*\}/);
  if (objectMatch?.[0]) return JSON.parse(objectMatch[0]);
  throw new Error("AI returned non-JSON content");
}

async function readAiHttpError(response: Response): Promise<string> {
  const friendly = friendlyHttpError(response.status);
  try {
    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      const data = (await response.json()) as { error?: { message?: unknown } | string; message?: unknown };
      const message =
        typeof data.error === "string"
          ? data.error
          : typeof data.error?.message === "string"
            ? data.error.message
            : typeof data.message === "string"
              ? data.message
              : "";
      return message ? `${friendly} ${message}` : friendly;
    }
    const text = (await response.text()).trim();
    return text ? `${friendly} ${text.slice(0, 300)}` : friendly;
  } catch {
    return friendly;
  }
}

function friendlyHttpError(status: number): string {
  if (status === 401 || status === 403) return `AI 鉴权失败：HTTP ${status}。请检查 API Key 或供应商权限。`;
  if (status === 404) return "AI 端点不存在：HTTP 404。请检查 Base URL 是否以 /v1 结尾。";
  if (status === 429) return "AI 请求被限流：HTTP 429。请稍后重试或检查额度。";
  if (status >= 500) return `AI 服务暂不可用：HTTP ${status}。`;
  return `AI 请求失败：HTTP ${status}。`;
}

function readableAiException(error: unknown, timeoutMessage: string): string {
  return error instanceof Error && error.name === "AbortError" ? timeoutMessage : readableError(error);
}

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
