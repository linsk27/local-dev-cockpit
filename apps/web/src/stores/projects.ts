import { defineStore } from "pinia";
import type { Project } from "@local-dev-cockpit/core";
import { getContext, getLogs, getProjects, startCommand, stopProcess, type ContextResponse } from "../api";

export const useProjectsStore = defineStore("projects", {
  state: () => ({
    projects: [] as Project[],
    selectedId: "" as string,
    loading: false,
    refreshing: false,
    error: "",
    logs: "",
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
      this.logs = "";
      this.context = null;
    },
    async runCommand(commandId: string) {
      const project = this.selectedProject;
      if (!project) return;
      const result = await startCommand(project.id, commandId);
      await this.refresh();
      await this.loadLogs(result.run.id);
    },
    async stop(runId: string, projectId?: string) {
      const targetProjectId = projectId ?? this.selectedProject?.id;
      if (!targetProjectId) return;
      await stopProcess(targetProjectId, runId);
      await this.refresh();
    },
    async loadLogs(runId?: string) {
      const project = this.selectedProject;
      const targetRun = runId ?? project?.lastRun?.id;
      if (!project || !targetRun) {
        this.logs = "";
        return;
      }
      this.logs = await getLogs(project.id, targetRun);
    },
    async loadContext() {
      const project = this.selectedProject;
      if (!project) return;
      this.context = await getContext(project.id);
    }
  }
});
