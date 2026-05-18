import type { ProcessRun, Project, RecoveryCard } from "@local-dev-cockpit/core";

export interface ProjectsResponse {
  projects: Project[];
}

export interface ContextResponse {
  context: string;
  agents: string;
  recovery: RecoveryCard;
}

export async function getProjects(): Promise<Project[]> {
  const response = await fetch("/api/projects");
  if (!response.ok) throw new Error(`Failed to load projects: ${response.status}`);
  return ((await response.json()) as ProjectsResponse).projects;
}

export async function getProject(projectId: string): Promise<Project> {
  const response = await fetch(`/api/projects/${projectId}`);
  if (!response.ok) throw new Error(`Failed to load project: ${response.status}`);
  return ((await response.json()) as { project: Project }).project;
}

export async function startCommand(projectId: string, commandId: string) {
  const response = await fetch(`/api/projects/${projectId}/commands/${encodeURIComponent(commandId)}/start`, {
    method: "POST"
  });
  if (!response.ok) throw new Error(`Failed to start command: ${response.status}`);
  return response.json() as Promise<{ run: ProcessRun }>;
}

export async function stopProcess(projectId: string, processId: string) {
  const response = await fetch(`/api/projects/${projectId}/processes/${encodeURIComponent(processId)}/stop`, {
    method: "POST"
  });
  if (!response.ok) throw new Error(`Failed to stop process: ${response.status}`);
  return response.json() as Promise<{ stopped: boolean }>;
}

export async function getLogs(projectId: string, runId: string): Promise<string> {
  const response = await fetch(`/api/projects/${projectId}/logs?runId=${encodeURIComponent(runId)}`);
  if (!response.ok) throw new Error(`Failed to load logs: ${response.status}`);
  return ((await response.json()) as { logs: string }).logs;
}

export async function getContext(projectId: string): Promise<ContextResponse> {
  const response = await fetch(`/api/projects/${projectId}/context`);
  if (!response.ok) throw new Error(`Failed to load context: ${response.status}`);
  return response.json() as Promise<ContextResponse>;
}

export async function addRoot(path: string) {
  const response = await fetch("/api/roots", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path })
  });
  if (!response.ok) throw new Error(`Failed to add root: ${response.status}`);
  return response.json();
}
