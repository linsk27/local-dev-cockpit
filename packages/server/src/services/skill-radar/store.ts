import { promises as fs } from "node:fs";
import path from "node:path";
import type { AiSettings } from "../../store.js";
import type { AppPaths } from "../../paths.js";
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
  type SkillCreateInput,
  type SkillItem,
  type SkillPreviewCommitInput,
  type SkillUpdateInput
} from "./types.js";

const SKILL_FILE_VERSION = 1;

export class SkillRadarStore {
  private readonly filePath: string;

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

  async importData(rawInput: unknown): Promise<ResourceImportResult> {
    const input = resourceImportInputSchema.parse(rawInput);
    const file = await this.readFile();
    const existing = new Set<string>();
    for (const item of file.items) {
      for (const key of resourceDedupKeys(item)) existing.add(key);
    }

    const added: SkillItem[] = [];
    let skipped = 0;
    for (const rawItem of input.items) {
      const item = normalizeResourceTaxonomy(skillItemSchema.parse(rawItem));
      const keys = resourceDedupKeys(item);
      if (keys.some((key) => existing.has(key))) {
        skipped += 1;
        continue;
      }
      for (const key of keys) existing.add(key);
      added.push(item);
    }

    if (added.length > 0) {
      await this.writeFile([...added, ...file.items]);
    }
    return {
      added: added.length,
      skipped,
      total: input.items.length,
      items: sortSkills([...added, ...file.items])
    };
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
    file.items.unshift(enhanced);
    await this.writeFile(file.items);
    return enhanced;
  }

  async commitPreview(rawInput: unknown): Promise<SkillItem> {
    const input = skillPreviewCommitInputSchema.parse(rawInput) as SkillPreviewCommitInput;
    const file = await this.readFile();
    const now = new Date().toISOString();
    const committed = normalizeResourceTaxonomy(
      skillItemSchema.parse({
        ...input.preview,
        createdAt: input.preview.createdAt || now,
        updatedAt: now
      })
    );
    file.items = [committed, ...file.items.filter((item) => item.id !== committed.id)];
    await this.writeFile(file.items);
    return committed;
  }

  async analyze(id: string, options: { aiSettings?: AiSettings } = {}): Promise<SkillItem | undefined> {
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
  }

  async update(id: string, rawInput: unknown): Promise<SkillItem | undefined> {
    const input = skillUpdateInputSchema.parse(rawInput) as SkillUpdateInput;
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
  }

  async remove(id: string): Promise<boolean> {
    const file = await this.readFile();
    const next = file.items.filter((item) => item.id !== id);
    if (next.length === file.items.length) return false;
    await this.writeFile(next);
    return true;
  }

  private async readFile(): Promise<{ version: number; items: SkillItem[] }> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const parsed = skillsFileSchema.safeParse(JSON.parse(raw));
      return parsed.success
        ? { ...parsed.data, items: parsed.data.items.map(normalizeResourceTaxonomy) }
        : { version: SKILL_FILE_VERSION, items: [] };
    } catch {
      return { version: SKILL_FILE_VERSION, items: [] };
    }
  }

  private async writeFile(items: SkillItem[]): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify({ version: SKILL_FILE_VERSION, items }, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
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
  const title = item.title.trim().toLowerCase();
  const summary = item.summary.trim().toLowerCase().slice(0, 120);
  if (title && summary) keys.push(`title:${title}|summary:${summary}`);
  return keys;
}

function normalizeResourceUrl(value: string | undefined): string {
  const raw = value?.trim();
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    if (url.pathname.endsWith("/") && url.pathname.length > 1) url.pathname = url.pathname.slice(0, -1);
    return url.toString().toLowerCase();
  } catch {
    return raw.toLowerCase();
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
