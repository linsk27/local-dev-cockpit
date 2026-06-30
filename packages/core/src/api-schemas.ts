import { z } from "zod";

export const aiProviderIdSchema = z.enum(["openai", "rayinai", "deepseek", "siliconflow", "openrouter", "ollama", "custom"]);
export const aiOutputLocaleSchema = z.enum(["zh-CN", "en-US", "source"]);
export const resourceStatusSchema = z.enum(["inbox", "useful", "archived"]);
export const resourceKindSchema = z.enum(["skill-md", "github-repo", "mcp", "prompt", "workflow", "demo", "tool", "article", "unknown"]);

export const resourceCreateInputSchema = z.object({
  sourceUrl: z.string().max(2000).optional(),
  sourceText: z.string().max(80_000).optional(),
  outputLocale: aiOutputLocaleSchema.optional()
});

export const resourceAiConfigUpdateSchema = z.object({
  providerId: aiProviderIdSchema.optional(),
  baseUrl: z.string().max(500).optional(),
  model: z.string().max(160).optional(),
  outputLocale: aiOutputLocaleSchema.optional(),
  apiKey: z.string().max(4000).optional(),
  clearApiKey: z.boolean().optional()
});

export const resourceUpdateInputSchema = z.object({
  title: z.string().max(240).optional(),
  summary: z.string().max(4000).optional(),
  category: z.string().max(240).optional(),
  categoryPath: z.array(z.string().max(120)).max(4).optional(),
  taxonomySource: z.enum(["rules", "ai", "manual"]).optional(),
  tags: z.array(z.string().max(60)).max(20).optional(),
  status: resourceStatusSchema.optional()
});

export type ResourceCreateInputFromSchema = z.infer<typeof resourceCreateInputSchema>;
export type ResourceAiConfigUpdateFromSchema = z.infer<typeof resourceAiConfigUpdateSchema>;
export type ResourceUpdateInputFromSchema = z.infer<typeof resourceUpdateInputSchema>;
