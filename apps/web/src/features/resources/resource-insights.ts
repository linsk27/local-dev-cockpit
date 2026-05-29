import type { RadarItem } from "../../api";
import { displayCategoryPath } from "./resource-filters";

export type ResourceRelationReason =
  | "same-source"
  | "same-kind"
  | "same-category"
  | "same-subcategory"
  | "same-host"
  | "tag-overlap"
  | "title-overlap";

export interface ResourceRelation {
  item: RadarItem;
  score: number;
  duplicate: boolean;
  reasons: ResourceRelationReason[];
}

export function getResourceRelations(items: RadarItem[], current: RadarItem, limit = 5): ResourceRelation[] {
  return items
    .filter((item) => item.id !== current.id)
    .map((item) => scoreRelation(current, item))
    .filter((relation) => relation.score >= 18 || relation.duplicate)
    .sort((left, right) => {
      if (left.duplicate !== right.duplicate) return left.duplicate ? -1 : 1;
      return right.score - left.score || right.item.confidence - left.item.confidence || right.item.updatedAt.localeCompare(left.item.updatedAt);
    })
    .slice(0, limit);
}

function scoreRelation(current: RadarItem, candidate: RadarItem): ResourceRelation {
  const reasons: ResourceRelationReason[] = [];
  let score = 0;

  const currentSource = normalizeSource(current.sourceUrl);
  const candidateSource = normalizeSource(candidate.sourceUrl);
  const sameSource = Boolean(currentSource && candidateSource && currentSource === candidateSource);
  if (sameSource) {
    score += 100;
    reasons.push("same-source");
  }

  if (current.kind === candidate.kind) {
    score += 14;
    reasons.push("same-kind");
  }

  const currentPath = displayCategoryPath(current);
  const candidatePath = displayCategoryPath(candidate);
  if (currentPath[0] && currentPath[0] === candidatePath[0]) {
    score += 24;
    reasons.push("same-category");
  }
  if (currentPath[1] && currentPath[1] === candidatePath[1]) {
    score += 18;
    reasons.push("same-subcategory");
  }

  const currentHost = sourceHost(current.sourceUrl);
  const candidateHost = sourceHost(candidate.sourceUrl);
  if (currentHost && currentHost === candidateHost && !sameSource) {
    score += 8;
    reasons.push("same-host");
  }

  const tagScore = jaccard(normalizedSet(current.tags), normalizedSet(candidate.tags));
  if (tagScore > 0) {
    score += Math.round(tagScore * 22);
    reasons.push("tag-overlap");
  }

  const titleScore = jaccard(tokenize(current.title), tokenize(candidate.title));
  if (titleScore >= 0.2) {
    score += Math.round(titleScore * 18);
    reasons.push("title-overlap");
  }

  return {
    item: candidate,
    score: Math.min(100, score),
    duplicate: sameSource,
    reasons: uniqueReasons(reasons)
  };
}

function normalizeSource(value?: string): string {
  if (!value) return "";
  try {
    const url = new URL(value);
    url.hash = "";
    url.search = "";
    const pathname = url.pathname.replace(/\/+$/g, "");
    return `${url.protocol}//${url.host.toLowerCase()}${pathname.toLowerCase()}`;
  } catch {
    return value.trim().replace(/\/+$/g, "").toLowerCase();
  }
}

function sourceHost(value?: string): string {
  if (!value) return "";
  try {
    return new URL(value).host.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizedSet(values: string[]): Set<string> {
  return new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function tokenize(value: string): Set<string> {
  const normalized = value.toLowerCase();
  const tokens = normalized.match(/[a-z0-9][a-z0-9-]{1,}|[\u4e00-\u9fa5]{2,}/g) ?? [];
  return new Set(tokens.map((token) => token.trim()).filter(Boolean));
}

function jaccard(left: Set<string>, right: Set<string>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const value of left) {
    if (right.has(value)) intersection += 1;
  }
  return intersection / (left.size + right.size - intersection);
}

function uniqueReasons(reasons: ResourceRelationReason[]): ResourceRelationReason[] {
  return [...new Set(reasons)];
}
