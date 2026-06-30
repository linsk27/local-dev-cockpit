import path from "node:path";
import type { AiSettings } from "../../store.js";
import type { AppPaths } from "../../paths.js";
import { FileOperationQueue } from "../file-operation-queue.js";
import { readJsonFile, writeJsonAtomic } from "../json-file.js";
import { migrateVersionedJson } from "../json-migrations.js";
import { analyzeSkillInput } from "./analyzer.js";
import { analyzeResourceWithAi } from "./ai.js";
import { fetchResourceMetadata } from "./fetcher.js";
import { categoryPathsFromItems, normalizeResourceTaxonomy } from "./taxonomy.js";
import {
  skillCreateInputSchema,
  resourceImportInputSchema,
  skillItemSchema,
  skillPreviewCommitInputSchema,
  skillsFileSchema,
  skillUpdateInputSchema,
  type ResourceExportPayload,
  type ResourceImportResult,
  type ResourceSummary,
  type SkillCreateInput,
  type SkillItem,
  type SkillPreviewCommitInput,
  type SkillUpdateInput
} from "./types.js";

const SKILL_FILE_VERSION = 1;

export class DuplicateResourceError extends Error {
  readonly statusCode = 409;

  constructor(
    readonly existing: Pick<SkillItem, "id" | "title" | "sourceUrl">,
    readonly duplicateKey: string
  ) {
    super(`资源已存在：${existing.title}`);
    this.name = "DuplicateResourceError";
  }

  get body(): { error: string; duplicate: Pick<SkillItem, "id" | "title" | "sourceUrl">; duplicateKey: string } {
    return {
      error: this.message,
      duplicate: this.existing,
      duplicateKey: this.duplicateKey
    };
  }
}

export class SkillRadarStore {
  private readonly filePath: string;
  private readonly fileQueue = new FileOperationQueue();

  constructor(paths: AppPaths) {
    this.filePath = path.join(paths.dataDir, "skill-radar.json");
  }

  async list(): Promise<SkillItem[]> {
    const file = await this.readFile();
    return sortSkills(file.items);
  }

  async get(id: string): Promise<SkillItem | undefined> {
    const file = await this.readFile();
    return file.items.find((item) => item.id === id);
  }

  async exportData(): Promise<ResourceExportPayload> {
    const file = await this.readFile();
    return {
      app: "dev-cockpit-resource-radar",
      version: SKILL_FILE_VERSION,
      exportedAt: new Date().toISOString(),
      items: sortSkills(file.items)
    };
  }

  async summary(): Promise<ResourceSummary> {
    const file = await this.readFile();
    const statuses: Record<string, number> = {};
    const kinds: Record<string, number> = {};
    const categoryTree = new Map<string, { count: number; children: Map<string, number> }>();
    let updatedAt = "";

    for (const item of file.items) {
      statuses[item.status] = (statuses[item.status] ?? 0) + 1;
      kinds[item.kind] = (kinds[item.kind] ?? 0) + 1;
      if (!updatedAt || item.updatedAt > updatedAt) updatedAt = item.updatedAt;
      const [major, minor] = item.categoryPath ?? [];
      if (!major) continue;
      const entry = categoryTree.get(major) ?? { count: 0, children: new Map<string, number>() };
      entry.count += 1;
      if (minor) entry.children.set(minor, (entry.children.get(minor) ?? 0) + 1);
      categoryTree.set(major, entry);
    }

    return {
      total: file.items.length,
      updatedAt: updatedAt || undefined,
      statuses,
      kinds,
      categories: [...categoryTree.entries()]
        .map(([major, entry]) => ({
          major,
          count: entry.count,
          children: [...entry.children.entries()]
            .map(([minor, count]) => ({ minor, count }))
            .sort((left, right) => right.count - left.count || left.minor.localeCompare(right.minor, "zh-CN"))
        }))
        .sort((left, right) => right.count - left.count || left.major.localeCompare(right.major, "zh-CN"))
    };
  }

  async importData(rawInput: unknown): Promise<ResourceImportResult> {
    const rawItems = extractRawImportItems(rawInput);
    return this.fileQueue.run(async () => {
      const file = await this.readFile();
      const existing = new Set<string>();
      for (const item of file.items) {
        for (const key of resourceDedupKeys(item)) existing.add(key);
      }

      const added: SkillItem[] = [];
      let skipped = 0;
      let failed = 0;
      for (const rawItem of rawItems) {
        const parsed = skillItemSchema.safeParse(rawItem);
        if (!parsed.success) {
          failed += 1;
          continue;
        }
        const item = normalizeResourceTaxonomy(parsed.data);
        const keys = resourceDedupKeys(item);
        if (keys.some((key) => existing.has(key))) {
          skipped += 1;
          continue;
        }
        for (const key of keys) existing.add(key);
        added.push(item);
      }

      const items = [...added, ...file.items];
      if (added.length > 0) {
        await this.writeFile(items);
      }
      return {
        added: added.length,
        skipped,
        failed,
        total: rawItems.length,
        items: sortSkills(items)
      };
    });
  }

  async preview(rawInput: unknown, options: { aiSettings?: AiSettings } = {}): Promise<SkillItem> {
    const input = skillCreateInputSchema.parse(rawInput) as SkillCreateInput;
    const file = await this.readFile();
    return buildAnalyzedResource(input, {
      aiSettings: applyImportLocale(options.aiSettings, input),
      reportMissingKey: false,
      existingCategoryPaths: categoryPathsFromItems(file.items)
    });
  }

  async create(rawInput: unknown, options: { aiSettings?: AiSettings } = {}): Promise<SkillItem> {
    const input = skillCreateInputSchema.parse(rawInput) as SkillCreateInput;
    const file = await this.readFile();
    const enhanced = await buildAnalyzedResource(input, {
      aiSettings: applyImportLocale(options.aiSettings, input),
      reportMissingKey: false,
      existingCategoryPaths: categoryPathsFromItems(file.items)
    });
    return this.fileQueue.run(async () => {
      const current = await this.readFile();
      assertUniqueResource(current.items, enhanced);
      current.items.unshift(enhanced);
      await this.writeFile(current.items);
      return enhanced;
    });
  }

  async commitPreview(rawInput: unknown): Promise<SkillItem> {
    const input = skillPreviewCommitInputSchema.parse(rawInput) as SkillPreviewCommitInput;
    const now = new Date().toISOString();
    const committed = normalizeResourceTaxonomy(
      skillItemSchema.parse({
        ...input.preview,
        createdAt: input.preview.createdAt || now,
        updatedAt: now
      })
    );
    return this.fileQueue.run(async () => {
      const file = await this.readFile();
      assertUniqueResource(file.items, committed, committed.id);
      file.items = [committed, ...file.items.filter((item) => item.id !== committed.id)];
      await this.writeFile(file.items);
      return committed;
    });
  }

  async analyze(id: string, options: { aiSettings?: AiSettings } = {}): Promise<SkillItem | undefined> {
    return this.fileQueue.run(async () => {
      const file = await this.readFile();
      const index = file.items.findIndex((item) => item.id === id);
      if (index < 0) return undefined;

      const current = file.items[index]!;
      const metadataResult = await fetchResourceMetadata(current.sourceUrl ?? "");
      const ruleItem = analyzeSkillInput(
        {
          sourceUrl: current.sourceUrl ?? "",
          sourceText: current.sourceText ?? ""
        },
        {
          metadata: metadataResult.metadata ?? current.rawMetadata,
          analysisSource: metadataResult.metadata || current.rawMetadata ? "metadata" : "rules",
          analysisError: metadataResult.error
        }
      );

      let updated: SkillItem = normalizeResourceTaxonomy({
        ...current,
        title: ruleItem.title,
        kind: ruleItem.kind,
        category: ruleItem.category,
        categoryPath: ruleItem.categoryPath,
        taxonomySource: ruleItem.taxonomySource,
        tags: ruleItem.tags,
        confidence: ruleItem.confidence,
        summary: ruleItem.summary,
        analysisSource: ruleItem.analysisSource,
        sourceFetchedAt: metadataResult.metadata ? ruleItem.sourceFetchedAt : current.sourceFetchedAt,
        analysisError: metadataResult.error,
        rawMetadata: metadataResult.metadata ?? current.rawMetadata,
        updatedAt: new Date().toISOString()
      });

      updated = await enhanceWithOptionalAi(updated, {
        aiSettings: options.aiSettings,
        reportMissingKey: true,
        existingCategoryPaths: categoryPathsFromItems(file.items.filter((item) => item.id !== current.id))
      });

      file.items[index] = updated;
      await this.writeFile(file.items);
      return updated;
    });
  }

  async update(id: string, rawInput: unknown): Promise<SkillItem | undefined> {
    const input = skillUpdateInputSchema.parse(rawInput) as SkillUpdateInput;
    return this.fileQueue.run(async () => {
      const file = await this.readFile();
      const index = file.items.findIndex((item) => item.id === id);
      if (index < 0) return undefined;
      const current = file.items[index]!;
      const updated = normalizeResourceTaxonomy({
        ...current,
        ...input,
        tags: input.tags ? normalizeManualTags(input.tags) : current.tags,
        updatedAt: new Date().toISOString()
      });
      file.items[index] = updated;
      await this.writeFile(file.items);
      return updated;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.fileQueue.run(async () => {
      const file = await this.readFile();
      const next = file.items.filter((item) => item.id !== id);
      if (next.length === file.items.length) return false;
      await this.writeFile(next);
      return true;
    });
  }

  private async readFile(): Promise<{ version: number; items: SkillItem[] }> {
    return readJsonFile(
      this.filePath,
      (value) => {
        const parsed = skillsFileSchema.safeParse(migrateVersionedJson(value, SKILL_FILE_VERSION));
        return parsed.success
          ? { ...parsed.data, items: parsed.data.items.map(normalizeResourceTaxonomy) }
          : { version: SKILL_FILE_VERSION, items: [] };
      },
      () => ({ version: SKILL_FILE_VERSION, items: [] })
    );
  }

  private async writeFile(items: SkillItem[]): Promise<void> {
    await writeJsonAtomic(this.filePath, { version: SKILL_FILE_VERSION, items });
  }
}

function sortSkills(items: SkillItem[]): SkillItem[] {
  return [...items].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
}

function normalizeManualTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const normalized: string[] = [];
  for (const tag of tags) {
    const value = tag.trim().toLowerCase();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    normalized.push(value);
    if (normalized.length >= 20) break;
  }
  return normalized;
}

function resourceDedupKeys(item: SkillItem): string[] {
  const keys = [`id:${item.id}`];
  const url = normalizeResourceUrl(item.sourceUrl);
  if (url) keys.push(`url:${url}`);
  const githubRepo = githubRepoKey(item);
  if (githubRepo) keys.push(`github:${githubRepo}`);
  const title = item.title.trim().toLowerCase();
  const summary = item.summary.trim().toLowerCase().slice(0, 120);
  if (title && summary) keys.push(`title:${title}|summary:${summary}`);
  return keys;
}

function assertUniqueResource(existingItems: SkillItem[], candidate: SkillItem, excludeId = ""): void {
  const duplicate = findDuplicateResource(existingItems, candidate, excludeId);
  if (duplicate) throw new DuplicateResourceError(duplicate.item, duplicate.key);
}

function findDuplicateResource(
  existingItems: SkillItem[],
  candidate: SkillItem,
  excludeId = ""
): { item: Pick<SkillItem, "id" | "title" | "sourceUrl">; key: string } | undefined {
  const candidateKeys = new Set(resourceDedupKeys(candidate));
  for (const item of existingItems) {
    if (excludeId && item.id === excludeId) continue;
    for (const key of resourceDedupKeys(item)) {
      if (candidateKeys.has(key)) return { item: { id: item.id, title: item.title, sourceUrl: item.sourceUrl }, key };
    }
  }
  return undefined;
}

function extractRawImportItems(rawInput: unknown): unknown[] {
  const parsed = resourceImportInputSchema.safeParse(rawInput);
  if (parsed.success) return parsed.data.items;
  if (Array.isArray(rawInput)) return rawInput;
  if (typeof rawInput === "object" && rawInput !== null && Array.isArray((rawInput as { items?: unknown }).items)) {
    return (rawInput as { items: unknown[] }).items;
  }
  resourceImportInputSchema.parse(rawInput);
  return [];
}

function normalizeResourceUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) || !/^[\w.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    url.hash = "";
    url.hostname = url.hostname.toLowerCase().replace(/^www\./, "");
    if (url.pathname.endsWith("/") && url.pathname.length > 1) url.pathname = url.pathname.slice(0, -1);
    return url.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
  }
}

function githubRepoKey(item: SkillItem): string {
  const fullName = item.rawMetadata?.repository?.fullName?.trim().toLowerCase();
  if (fullName) return fullName;
  const raw = item.sourceUrl?.trim();
  if (!raw) return "";
  const candidate = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    const url = new URL(candidate);
    if (!/(^|\.)github\.com$/i.test(url.hostname)) return "";
    const [owner, repo] = url.pathname.split("/").filter(Boolean);
    if (!owner || !repo) return "";
    return `${owner.toLowerCase()}/${repo.replace(/\.git$/i, "").toLowerCase()}`;
  } catch {
    return "";
  }
}

async function buildAnalyzedResource(
  input: SkillCreateInput,
  options: { aiSettings?: AiSettings; reportMissingKey: boolean; existingCategoryPaths?: string[][] }
): Promise<SkillItem> {
  const metadataResult = await fetchResourceMetadata(input.sourceUrl);
  const item = normalizeResourceTaxonomy(
    analyzeSkillInput(input, {
      metadata: metadataResult.metadata,
      analysisSource: metadataResult.metadata ? "metadata" : "rules",
      analysisError: metadataResult.error
    })
  );
  return enhanceWithOptionalAi(item, options);
}

async function enhanceWithOptionalAi(
  item: SkillItem,
  options: { aiSettings?: AiSettings; reportMissingKey: boolean; existingCategoryPaths?: string[][] }
): Promise<SkillItem> {
  const aiResult = await analyzeResourceWithAi(item, options.aiSettings, { existingCategoryPaths: options.existingCategoryPaths });
  if (aiResult.patch) {
    return normalizeResourceTaxonomy({
      ...item,
      ...aiResult.patch,
      tags: normalizeManualTags(aiResult.patch.tags),
      outputLocale: aiResult.patch.outputLocale ?? options.aiSettings?.outputLocale,
      analysisSource: item.rawMetadata ? "mixed" : "ai",
      analysisError: undefined,
      updatedAt: new Date().toISOString()
    });
  }
  if (aiResult.error && (aiResult.configured || options.reportMissingKey)) {
    return {
      ...item,
      analysisError: aiResult.error,
      updatedAt: new Date().toISOString()
    };
  }
  return item;
}

function applyImportLocale(settings: AiSettings | undefined, input: SkillCreateInput): AiSettings | undefined {
  if (!settings || !input.outputLocale) return settings;
  return { ...settings, outputLocale: input.outputLocale };
}
