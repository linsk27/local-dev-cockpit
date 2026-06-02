import type { RadarItem, ResourceKind, ResourceStatus } from "../../api";

export type ResourceFilter = "all" | ResourceStatus | ResourceKind | `category:${string}`;

export interface ResourceCategoryNode {
  major: string;
  count: number;
  children: Array<{ minor: string; count: number }>;
}

export interface ResourceFilterCounts {
  [key: string]: number;
  all: number;
  inbox: number;
  useful: number;
  archived: number;
  "skill-md": number;
  "github-repo": number;
  mcp: number;
  prompt: number;
  workflow: number;
  demo: number;
  tool: number;
  article: number;
  unknown: number;
}

export interface ParsedCategoryFilter {
  major: string;
  minor?: string;
}

export function filterResources(items: RadarItem[], options: { query: string; filter: ResourceFilter }): RadarItem[] {
  const query = options.query.trim().toLowerCase();
  return items.filter((item) => {
    if (!matchesFilter(item, options.filter)) return false;
    if (!query) return true;
    const haystack = [item.title, item.summary, item.category, item.kind, item.status, item.sourceUrl, ...displayCategoryPath(item), ...item.tags]
      .filter(Boolean)
      .join("\n")
      .toLowerCase();
    return haystack.includes(query);
  });
}

export function countResourceFilters(items: RadarItem[]): ResourceFilterCounts {
  const counts: ResourceFilterCounts = {
    all: items.length,
    inbox: 0,
    useful: 0,
    archived: 0,
    "skill-md": 0,
    "github-repo": 0,
    mcp: 0,
    prompt: 0,
    workflow: 0,
    demo: 0,
    tool: 0,
    article: 0,
    unknown: 0
  };
  for (const item of items) {
    counts[item.status] += 1;
    counts[item.kind] += 1;
    for (const category of majorCategories(item)) {
      const key = categoryFilterValue(category);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    const path = displayCategoryPath(item);
    if (path[0] && path[1]) {
      const key = categoryFilterValue(path[0], path[1]);
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  return counts;
}

export function groupResourcesByCategory(items: RadarItem[]): Array<{ category: string; items: RadarItem[] }> {
  const groups = new Map<string, RadarItem[]>();
  for (const item of items) {
    const category = displayCategory(item);
    const group = groups.get(category) ?? [];
    group.push(item);
    groups.set(category, group);
  }
  return [...groups.entries()]
    .map(([category, groupItems]) => ({ category, items: groupItems }))
    .sort((left, right) => right.items.length - left.items.length || left.category.localeCompare(right.category, "zh-CN"));
}

export function getMajorCategories(items: RadarItem[]): string[] {
  const seen = new Set<string>();
  for (const item of items) {
    for (const category of majorCategories(item)) {
      if (category) seen.add(category);
    }
  }
  return [...seen].sort((left, right) => left.localeCompare(right, "zh-CN"));
}

export function getCategoryTree(items: RadarItem[]): ResourceCategoryNode[] {
  const tree = new Map<string, { count: number; children: Map<string, number> }>();
  for (const item of items) {
    const path = displayCategoryPath(item);
    const major = path[0] || majorCategories(item)[0];
    if (!major) continue;
    const entry = tree.get(major) ?? { count: 0, children: new Map<string, number>() };
    entry.count += 1;
    const minor = path[1];
    if (minor) entry.children.set(minor, (entry.children.get(minor) ?? 0) + 1);
    tree.set(major, entry);
  }
  return [...tree.entries()]
    .map(([major, entry]) => ({
      major,
      count: entry.count,
      children: [...entry.children.entries()]
        .map(([minor, count]) => ({ minor, count }))
        .sort((left, right) => right.count - left.count || left.minor.localeCompare(right.minor, "zh-CN"))
    }))
    .sort((left, right) => right.count - left.count || left.major.localeCompare(right.major, "zh-CN"));
}

export function categoryFilterValue(category: string, minor?: string): `category:${string}` {
  const majorValue = encodeCategoryFilterPart(category);
  const minorValue = minor ? `>${encodeCategoryFilterPart(minor)}` : "";
  return `category:${majorValue}${minorValue}`;
}

export function displayCategory(item: RadarItem): string {
  const path = displayCategoryPath(item);
  return path.length > 0 ? path.join(" / ") : item.category;
}

export function displayCategoryPath(item: RadarItem): string[] {
  return item.categoryPath?.map((part) => part.trim()).filter(Boolean) ?? [];
}

function matchesFilter(item: RadarItem, filter: ResourceFilter): boolean {
  if (filter === "all") return true;
  if (filter.startsWith("category:")) {
    const parsed = parseCategoryFilter(filter);
    if (!parsed) return false;
    const path = displayCategoryPath(item);
    if (parsed.minor) return path[0] === parsed.major && path[1] === parsed.minor;
    return majorCategories(item).includes(parsed.major);
  }
  return item.status === filter || item.kind === filter;
}

export function parseCategoryFilter(filter: ResourceFilter): ParsedCategoryFilter | undefined {
  if (!filter.startsWith("category:")) return undefined;
  const value = filter.slice("category:".length);
  const [major, minor] = value.split(">");
  const decodedMajor = decodeCategoryFilterPart(major ?? "");
  const decodedMinor = minor ? decodeCategoryFilterPart(minor) : undefined;
  return decodedMajor ? { major: decodedMajor, minor: decodedMinor } : undefined;
}

function majorCategories(item: RadarItem): string[] {
  const major = item.categoryPath?.[0]?.trim();
  if (major) return [major];
  const legacy = item.category ? item.category.split(/\s*(?:\/|>|→|·|\|)\s*/g)[0]?.trim() : "";
  return legacy ? [legacy] : [];
}

function encodeCategoryFilterPart(value: string): string {
  return encodeURIComponent(value.trim());
}

function decodeCategoryFilterPart(value: string): string {
  try {
    return decodeURIComponent(value).trim();
  } catch {
    return value.trim();
  }
}
