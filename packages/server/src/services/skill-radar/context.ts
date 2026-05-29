import type { SkillDraftPayload, SkillItem, SkillContextPayload } from "./types.js";

export function createSkillContext(item: SkillItem): SkillContextPayload {
  return {
    context: [
      `# Resource Radar Context: ${item.title}`,
      "",
      `- Source: ${item.sourceUrl ?? "pasted text"}`,
      `- Type: ${item.kind}`,
      `- Category: ${item.category}`,
      `- Status: ${item.status}`,
      `- Confidence: ${item.confidence}/100`,
      `- Analysis source: ${item.analysisSource ?? "rules"}`,
      `- Tags: ${item.tags.length > 0 ? item.tags.join(", ") : "none"}`,
      item.previewImageUrl ? `- Preview image: ${item.previewImageUrl}` : "",
      item.rawMetadata?.repository
        ? `- Repository: ${item.rawMetadata.repository.fullName ?? item.rawMetadata.repository.name ?? "unknown"}${
            typeof item.rawMetadata.repository.stars === "number" ? `, ${item.rawMetadata.repository.stars} stars` : ""
          }${item.rawMetadata.repository.language ? `, ${item.rawMetadata.repository.language}` : ""}`
        : "",
      item.analysisError ? `- Analysis note: ${item.analysisError}` : "",
      "",
      "## Summary",
      item.summary,
      "",
      item.highlights?.length ? ["## Highlights", ...item.highlights.map((value) => `- ${value}`)].join("\n") : "",
      item.useCases?.length ? ["## Use Cases", ...item.useCases.map((value) => `- ${value}`)].join("\n") : "",
      item.evidence?.length ? ["## Evidence", ...item.evidence.map((value) => `- ${value}`)].join("\n") : "",
      item.rawMetadata?.links?.length ? ["## Key Links", ...item.rawMetadata.links.map((link) => `- ${link.label}: ${link.url}`)].join("\n") : "",
      "",
      "## What I need from AI",
      evaluationPrompt(item),
      "",
      item.rawMetadata?.textSample ? ["## Fetched Metadata", trimSource(item.rawMetadata.textSample)].join("\n") : "",
      item.sourceText ? ["## Source Text", trimSource(item.sourceText)].join("\n") : ""
    ]
      .filter(Boolean)
      .join("\n")
  };
}

export function createSkillDraft(item: SkillItem): SkillDraftPayload {
  if (item.kind === "demo") return { draft: createDemoAnalysis(item) };
  if (item.kind === "tool") return { draft: createToolAnalysis(item) };
  if (item.kind === "github-repo") return { draft: createRepositoryAnalysis(item) };
  if (item.kind === "article" || item.kind === "unknown") return { draft: createReviewChecklist(item) };

  const slug = slugify(item.title);
  const tags = item.tags.length > 0 ? item.tags.join(", ") : "ai-skill";
  return {
    draft: [
      "---",
      `name: ${slug}`,
      `description: ${escapeYaml(item.summary)}`,
      `tags: [${tags}]`,
      "---",
      "",
      `# ${item.title}`,
      "",
      "## When to use",
      `Use this skill when the user asks for work related to ${item.category.toLowerCase()} and the source material below is relevant.`,
      "",
      "## Workflow",
      "1. Read the user's request and confirm the relevant source context.",
      "2. Apply only the parts that match the current repository and task.",
      "3. Prefer local project conventions over generic advice.",
      "4. Summarize any assumptions before making changes.",
      "",
      "## Source Notes",
      item.summary,
      item.sourceUrl ? `\nSource: ${item.sourceUrl}` : "",
      "",
      "<!-- Review this draft before installing it as a real skill. -->"
    ]
      .filter(Boolean)
      .join("\n")
  };
}

function evaluationPrompt(item: SkillItem): string {
  if (item.kind === "demo") {
    return "Evaluate this demo as an AI development resource. Identify the interaction pattern, what can be learned from it, and whether it should become a reusable tool, workflow, prompt, or skill reference.";
  }
  if (item.kind === "tool") {
    return "Evaluate this tool as an AI development resource. Summarize the use case, setup cost, alternatives, and whether it deserves a reusable workflow card.";
  }
  if (item.kind === "github-repo") {
    return "Evaluate this repository as a tool or technique resource. Summarize what it does, adoption potential, integration risk, and whether it should become a reusable reference.";
  }
  if (item.kind === "article" || item.kind === "unknown") {
    return "Summarize this resource, extract useful claims, and produce a short review checklist for deciding whether to keep it.";
  }
  return "Evaluate whether this source is worth turning into a reusable AI coding skill. If useful, suggest a focused SKILL.md structure, scope boundaries, and test prompts.";
}

function createDemoAnalysis(item: SkillItem): string {
  return [
    `# Demo Analysis: ${item.title}`,
    "",
    "## What it appears to be",
    item.summary,
    "",
    "## Review checklist",
    "- What user problem does this demo make obvious?",
    "- Which interaction pattern is worth copying or avoiding?",
    "- Could this become a reusable workflow, prompt, tool, or skill?",
    "- What evidence is still missing before keeping it as a reference?",
    item.sourceUrl ? `\nSource: ${item.sourceUrl}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function createToolAnalysis(item: SkillItem): string {
  return [
    `# Tool Evaluation: ${item.title}`,
    "",
    "## Summary",
    item.summary,
    "",
    "## Evaluate",
    "- Primary use case",
    "- Setup or adoption cost",
    "- Similar tools to compare",
    "- When this should be used inside Dev Cockpit or an AI workflow",
    item.sourceUrl ? `\nSource: ${item.sourceUrl}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function createRepositoryAnalysis(item: SkillItem): string {
  return [
    `# Repository Resource Review: ${item.title}`,
    "",
    "## Summary",
    item.summary,
    "",
    "## Evaluate",
    "- What problem the repository solves",
    "- Whether it is a library, app, template, or research/demo repo",
    "- Maintenance and integration risks to verify",
    "- Whether it should become a skill, workflow, or implementation reference",
    item.sourceUrl ? `\nSource: ${item.sourceUrl}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function createReviewChecklist(item: SkillItem): string {
  return [
    `# Resource Review: ${item.title}`,
    "",
    "## Summary",
    item.summary,
    "",
    "## Keep or discard",
    "- Is the source still useful after one sentence of summary?",
    "- Is there a concrete workflow, tool, prompt, or implementation idea?",
    "- What tag or category should it belong to?",
    "- What follow-up action is needed?",
    item.sourceUrl ? `\nSource: ${item.sourceUrl}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function trimSource(value: string): string {
  const maxLength = 6000;
  return value.length <= maxLength ? value : `${value.slice(0, maxLength).trim()}\n\n[truncated]`;
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "draft-skill";
}

function escapeYaml(value: string): string {
  return JSON.stringify(value.length > 180 ? `${value.slice(0, 177)}...` : value);
}
