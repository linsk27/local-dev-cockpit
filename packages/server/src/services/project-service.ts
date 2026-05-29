import path from "node:path";
import { analyzeProject, decodeProjectId, NodeFileSystemAdapter, NodeProcessAdapter, scanRoot, type Project } from "@local-dev-cockpit/core";
import type { ProcessManager } from "../process-manager.js";
import { JsonStore, rootId } from "../store.js";
import { createEnrichmentContext, enrichProject } from "./port-status.js";

export async function loadProjects(store: JsonStore, processManager: ProcessManager, selectedRootId?: string | null): Promise<Project[]> {
  const config = await store.readConfig();
  const state = await store.readState();
  const discoveredProjects: Project[] = [];
  const roots = selectedRootId ? config.roots.filter((root) => rootId(root) === selectedRootId) : config.roots;

  for (const root of roots) {
    const result = await scanRoot(root, { ignoreNames: config.ignoreNames });
    discoveredProjects.push(...result.projects);
  }

  const projects = dedupeProjectsByPath(discoveredProjects);
  const enrichment = await createEnrichmentContext(projects);
  return Promise.all(
    projects.map((project) => enrichProject(project, state.runs[project.id], state.errors[project.id], processManager, enrichment))
  );
}

export async function loadProject(id: string, store: JsonStore, processManager: ProcessManager): Promise<Project> {
  const projectPath = decodeProjectId(id);
  const state = await store.readState();
  const project = await analyzeProject(projectPath, {
    fs: new NodeFileSystemAdapter(),
    process: new NodeProcessAdapter()
  });
  return enrichProject(project, state.runs[project.id], state.errors[project.id], processManager, await createEnrichmentContext([project]));
}

function dedupeProjectsByPath(projects: Project[]): Project[] {
  const seen = new Set<string>();
  const deduped: Project[] = [];
  for (const project of projects) {
    const key = normalizeProjectPath(project.path);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(project);
  }
  return deduped;
}

function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath).replace(/\\/g, "/").replace(/\/+$/g, "").toLowerCase();
}
