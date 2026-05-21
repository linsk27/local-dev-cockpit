import { analyzeProject, decodeProjectId, NodeFileSystemAdapter, NodeProcessAdapter, scanRoot, type Project } from "@local-dev-cockpit/core";
import type { ProcessManager } from "../process-manager.js";
import { JsonStore, rootId } from "../store.js";
import { createEnrichmentContext, enrichProject } from "./port-status.js";

export async function loadProjects(store: JsonStore, processManager: ProcessManager, selectedRootId?: string | null): Promise<Project[]> {
  const config = await store.readConfig();
  const state = await store.readState();
  const projects: Project[] = [];
  const roots = selectedRootId ? config.roots.filter((root) => rootId(root) === selectedRootId) : config.roots;

  for (const root of roots) {
    const result = await scanRoot(root, { ignoreNames: config.ignoreNames });
    projects.push(...result.projects);
  }

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
