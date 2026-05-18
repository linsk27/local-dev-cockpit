import { defineStore } from "pinia";
import type { ProcessRun, Project } from "@local-dev-cockpit/core";
import { getContext, getLogs, getProjects, startCommand, stopProcess, type ContextResponse } from "../api";

export type CommandActionState = "starting" | "stopping";

export const useProjectsStore = defineStore("projects", {
  state: () => ({
    projects: [] as Project[],
    selectedId: "" as string,
    loading: false,
    refreshing: false,
    error: "",
    logs: "",
    logsRunId: "",
    commandActions: {} as Record<string, CommandActionState>,
    context: null as ContextResponse | null
  }),
  getters: {
    selectedProject(state): Project | undefined {
      return state.projects.find((project) => project.id === state.selectedId) ?? state.projects[0];
    }
  },
  actions: {
    async refresh(options: { silent?: boolean } = {}) {
      if (this.refreshing) return;
      this.refreshing = true;
      if (!options.silent) this.loading = true;
      this.error = "";
      try {
        this.projects = await getProjects();
        if (!this.selectedId && this.projects[0]) this.selectedId = this.projects[0].id;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        if (!options.silent) this.loading = false;
        this.refreshing = false;
      }
    },
    select(projectId: string) {
      this.selectedId = projectId;
      this.clearLogs();
      this.context = null;
    },
    async runCommand(commandId: string) {
      const project = this.selectedProject;
      if (!project) return;
      const actionKey = commandActionKey(project.id, commandId);
      this.commandActions[actionKey] = "starting";
      this.error = "";
      try {
        const result = await startCommand(project.id, commandId);
        this.applyRun(project.id, result.run);
        this.logs = "";
        this.logsRunId = result.run.id;
        await this.loadLogs(result.run.id);
        await this.refresh({ silent: true });
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        delete this.commandActions[actionKey];
      }
    },
    async stop(runId: string, projectId?: string) {
      const targetProjectId = projectId ?? this.selectedProject?.id;
      if (!targetProjectId) return;
      const project = this.projects.find((item) => item.id === targetProjectId);
      const commandId = project?.lastRun?.id === runId ? project.lastRun.commandId : undefined;
      const actionKey = commandId ? commandActionKey(targetProjectId, commandId) : undefined;
      if (actionKey) this.commandActions[actionKey] = "stopping";
      this.error = "";
      try {
        await stopProcess(targetProjectId, runId);
        if (project?.lastRun?.id === runId) {
          this.applyRun(targetProjectId, {
            ...project.lastRun,
            status: "stopped",
            exitedAt: new Date().toISOString()
          });
        }
        await this.refresh({ silent: true });
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      } finally {
        if (actionKey) delete this.commandActions[actionKey];
      }
    },
    async loadLogs(runId?: string) {
      const project = this.selectedProject;
      const targetRun = runId ?? project?.lastRun?.id;
      if (!project || !targetRun) {
        this.clearLogs();
        return;
      }
      const targetProjectId = project.id;
      const logs = await getLogs(targetProjectId, targetRun);
      if (this.selectedId === targetProjectId) {
        this.logs = logs;
        this.logsRunId = targetRun;
      }
    },
    clearLogs() {
      this.logs = "";
      this.logsRunId = "";
    },
    async loadContext() {
      const project = this.selectedProject;
      if (!project) return;
      this.context = await getContext(project.id);
    },
    commandAction(projectId: string, commandId: string): CommandActionState | undefined {
      return this.commandActions[commandActionKey(projectId, commandId)];
    },
    applyRun(projectId: string, run: ProcessRun) {
      this.projects = this.projects.map((project) => (project.id === projectId ? { ...project, lastRun: run, lastError: undefined } : project));
    }
  }
});

function commandActionKey(projectId: string, commandId: string): string {
  return `${projectId}:${commandId}`;
}
