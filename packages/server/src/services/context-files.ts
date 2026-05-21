import { promises as fs } from "node:fs";
import path from "node:path";
import { createRecoveryCard, renderAgentsFile, renderProjectContext, type Project, type RecoveryCard } from "@local-dev-cockpit/core";

export function createProjectContextPayload(project: Project): { context: string; agents: string; recovery: RecoveryCard } {
  return {
    context: renderProjectContext(project),
    agents: renderAgentsFile(project),
    recovery: createRecoveryCard(project)
  };
}

export async function writeProjectContextFiles(project: Project): Promise<{ files: string[] }> {
  const contextPath = path.join(project.path, "PROJECT_CONTEXT.md");
  const agentsPath = path.join(project.path, "AGENTS.md");
  await fs.writeFile(contextPath, renderProjectContext(project), "utf8");
  await fs.writeFile(agentsPath, renderAgentsFile(project), "utf8");
  return { files: [contextPath, agentsPath] };
}
