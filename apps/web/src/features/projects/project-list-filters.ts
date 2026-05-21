import type { Project } from "@local-dev-cockpit/core";
import { projectHasStalePorts } from "./project-view-ports";
import { projectHasFailed, projectIsOnline } from "./project-view-status";

export type ProjectListFilter = "all" | "online" | "standard-runnable" | "try-runnable" | "needs-attention" | "unidentified";

export type ProjectListCategory = Exclude<ProjectListFilter, "all">;

export interface ProjectListFilterSummary {
  id: ProjectListFilter;
  count: number;
}

const FILTERS: ProjectListFilter[] = ["all", "online", "standard-runnable", "try-runnable", "needs-attention", "unidentified"];

/**
 * Classifies projects by startup confidence. This keeps the UI filter stable
 * while scanners continue to add support for more ecosystems.
 */
export function classifyProjectForList(project: Project): ProjectListCategory {
  if (projectIsOnline(project)) return "online";
  if (projectHasFailed(project) || projectHasStalePorts(project)) return "needs-attention";
  if (project.commands.length === 0) return "unidentified";
  if (hasStandardRunCommand(project)) return "standard-runnable";
  return "try-runnable";
}

export function projectMatchesListFilter(project: Project, filter: ProjectListFilter): boolean {
  return filter === "all" || classifyProjectForList(project) === filter;
}

export function buildProjectListFilters(projects: Project[]): ProjectListFilterSummary[] {
  const counts = new Map<ProjectListFilter, number>(FILTERS.map((filter) => [filter, 0]));
  counts.set("all", projects.length);
  for (const project of projects) {
    const category = classifyProjectForList(project);
    counts.set(category, (counts.get(category) ?? 0) + 1);
  }
  return FILTERS.map((id) => ({ id, count: counts.get(id) ?? 0 }));
}

function hasStandardRunCommand(project: Project): boolean {
  if (project.kind === "unknown") return false;
  return project.commands.some((command) => {
    const trustedSource = command.source === "package-script" || command.source === "detected";
    const startupKind = command.kind === "dev" || command.kind === "start";
    return trustedSource && startupKind;
  });
}
