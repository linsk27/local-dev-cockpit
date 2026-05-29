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
  skillItemSchema,
  skillPreviewCommitInputSchema,
  skillsFileSchema,
  skillUpdateInputSchema,
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
