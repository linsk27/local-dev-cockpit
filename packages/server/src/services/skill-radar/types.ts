import { z } from "zod";

export const skillKindSchema = z.enum([
  "skill-md",
  "github-repo",
  "mcp",
  "prompt",
  "workflow",
  "demo",
  "tool",
  "article",
  "unknown"
]);
const legacySkillStatusSchema = z.enum(["inbox", "reviewing", "useful", "testing", "converted", "archived", "rejected"]);
export const skillStatusSchema = z.enum(["inbox", "useful", "archived"]);
export const analysisSourceSchema = z.enum(["rules", "metadata", "ai", "mixed"]);
export const taxonomySourceSchema = z.enum(["rules", "ai", "manual"]);
export const resourceLanguageSchema = z.enum(["zh-CN", "en-US", "mixed", "unknown"]);
export const resourceOutputLocaleSchema = z.enum(["zh-CN", "en-US", "source"]);
export const categoryPathSchema = z.array(z.string().min(1).max(40)).min(1).max(2);

function normalizeResourceStatus(status: z.infer<typeof legacySkillStatusSchema>): z.infer<typeof skillStatusSchema> {
  if (status === "archived" || status === "rejected") return "archived";
  if (status === "useful" || status === "testing" || status === "converted") return "useful";
  return "inbox";
}

export const resourceImageSchema = z.object({
  label: z.string(),
  url: z.string(),
  source: z.enum(["og", "twitter", "readme", "page", "icon", "github-open-graph"]).optional()
});

export const resourceMetadataSchema = z
  .object({
    title: z.string().optional(),
    description: z.string().optional(),
    siteName: z.string().optional(),
    fetchedUrl: z.string().optional(),
    imageUrl: z.string().optional(),
    iconUrl: z.string().optional(),
    images: z.array(resourceImageSchema).max(12).optional(),
    textSample: z.string().optional(),
    links: z
      .array(
        z.object({
          label: z.string(),
          url: z.string()
        })
      )
      .optional(),
    repository: z
      .object({
        owner: z.string().optional(),
        name: z.string().optional(),
        fullName: z.string().optional(),
        description: z.string().optional(),
        language: z.string().optional(),
        stars: z.number().int().nonnegative().optional(),
        forks: z.number().int().nonnegative().optional(),
        topics: z.array(z.string()).optional(),
        homepage: z.string().optional(),
        license: z.string().optional(),
        defaultBranch: z.string().optional(),
        pushedAt: z.string().optional()
      })
      .optional()
  })
  .passthrough();

export const skillItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  sourceUrl: z.string().optional(),
  sourceText: z.string().optional(),
  kind: skillKindSchema,
  category: z.string(),
  categoryPath: categoryPathSchema.optional(),
  taxonomySource: taxonomySourceSchema.optional(),
  tags: z.array(z.string()),
  status: legacySkillStatusSchema.transform(normalizeResourceStatus),
  confidence: z.number().int().min(0).max(100),
  summary: z.string(),
  highlights: z.array(z.string().min(1).max(180)).max(5).optional(),
  useCases: z.array(z.string().min(1).max(180)).max(5).optional(),
  evidence: z.array(z.string().min(1).max(220)).max(6).optional(),
  previewImageUrl: z.string().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
  analysisSource: analysisSourceSchema.optional(),
  sourceFetchedAt: z.string().optional(),
  analysisError: z.string().optional(),
  language: resourceLanguageSchema.optional(),
  outputLocale: resourceOutputLocaleSchema.optional(),
  rawMetadata: resourceMetadataSchema.optional()
});

export const skillCreateInputSchema = z
  .object({
    sourceUrl: z.string().max(1200).optional().default(""),
    sourceText: z.string().max(120_000).optional().default(""),
    outputLocale: resourceOutputLocaleSchema.optional()
  })
  .transform((value) => ({
    sourceUrl: value.sourceUrl.trim(),
    sourceText: value.sourceText.trim(),
    outputLocale: value.outputLocale
  }))
  .refine((value) => value.sourceUrl.length > 0 || value.sourceText.length > 0, {
    message: "请先粘贴链接或文本。"
  });

export const skillUpdateInputSchema = z.object({
  title: z.string().min(1).max(160).optional(),
  summary: z.string().max(2000).optional(),
  category: z.string().min(1).max(80).optional(),
  categoryPath: categoryPathSchema.optional(),
  taxonomySource: taxonomySourceSchema.optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
  status: skillStatusSchema.optional()
});

export const skillPreviewCommitInputSchema = z.object({
  preview: skillItemSchema
});

export const skillsFileSchema = z.object({
  version: z.number().int().default(1),
  items: z.array(skillItemSchema).default([])
});

export const resourceExportSchema = z.object({
  app: z.literal("dev-cockpit-resource-radar").default("dev-cockpit-resource-radar"),
  version: z.number().int().default(1),
  exportedAt: z.string().optional(),
  items: z.array(skillItemSchema).default([])
});

export const resourceImportInputSchema = z
  .union([
    resourceExportSchema,
    z.object({
      version: z.number().int().optional(),
      items: z.array(skillItemSchema)
    }),
    z.array(skillItemSchema)
  ])
  .transform((value) => {
    if (Array.isArray(value)) return { items: value };
    return { items: value.items };
  });

export type SkillKind = z.infer<typeof skillKindSchema>;
export type SkillStatus = z.infer<typeof skillStatusSchema>;
export type AnalysisSource = z.infer<typeof analysisSourceSchema>;
export type TaxonomySource = z.infer<typeof taxonomySourceSchema>;
export type ResourceLanguage = z.infer<typeof resourceLanguageSchema>;
export type ResourceOutputLocale = z.infer<typeof resourceOutputLocaleSchema>;
export type ResourceImage = z.infer<typeof resourceImageSchema>;
export type ResourceMetadata = z.infer<typeof resourceMetadataSchema>;
export type SkillItem = z.infer<typeof skillItemSchema>;
export type SkillCreateInput = z.infer<typeof skillCreateInputSchema>;
export type SkillUpdateInput = z.infer<typeof skillUpdateInputSchema>;
export type SkillPreviewCommitInput = z.infer<typeof skillPreviewCommitInputSchema>;
export type ResourceExportPayload = z.infer<typeof resourceExportSchema>;
export type ResourceImportInput = z.infer<typeof resourceImportInputSchema>;
export interface ResourceImportResult {
  added: number;
  skipped: number;
  failed?: number;
  total: number;
  items: SkillItem[];
}
export interface ResourceSummary {
  total: number;
  updatedAt?: string;
  statuses: Record<string, number>;
  kinds: Record<string, number>;
  categories: Array<{ major: string; count: number; children: Array<{ minor: string; count: number }> }>;
}
export type ResourceKind = SkillKind;
export type ResourceStatus = SkillStatus;
export type ResourceAnalysisSource = AnalysisSource;
export type RadarItem = SkillItem;
export type ResourceCreateInput = SkillCreateInput;
export type ResourceUpdateInput = SkillUpdateInput;

export interface SkillContextPayload {
  context: string;
}

export interface SkillDraftPayload {
  draft: string;
}
