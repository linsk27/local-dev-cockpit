import { defineStore } from "pinia";
import type { PortStatus, ProcessRun, Project } from "@local-dev-cockpit/core";
import {
  getContext,
  getLogs,
  getProject,
  getProjects,
  openProjectEditor as openProjectEditorRequest,
  openProjectFolder as openProjectFolderRequest,
  startCommand,
  stopPort as stopPortRequest,
  stopProcess,
  writeContext,
  type ContextResponse,
  type StopPortResponse,
  type WriteContextResponse
} from "../api";

export type CommandActionState = "starting" | "stopping";
export type PortActionState = "stopping";

export const useProjectsStore = defineStore("projects", {
  state: () => ({
    projects: [] as Project[],
    rootId: "" as string,
    selectedId: "" as string,
    loading: false,
    refreshing: false,
    error: "",
    logs: "",
    logsRunId: "",
    commandActions: {} as Record<string, CommandActionState>,
    portActions: {} as Record<string, PortActionState>,
    runtimeWatches: {} as Record<string, string>,
    context: null as ContextResponse | null
  }),
  getters: {
    selectedProject(state): Project | undefined {
      return state.projects.find((project) => project.id === state.selectedId) ?? state.projects[0];
    }
  },
  actions: {
    async refresh(options: { silent?: boolean; force?: boolean; rootId?: string } = {}): Promise<boolean> {
      if (this.refreshing) return !this.error;
      this.refreshing = true;
      if (!options.silent) this.loading = true;
      this.error = "";
      try {
        const incomingProjects = await getProjects({ force: options.force, rootId: options.rootId });
        this.rootId = options.rootId ?? "";
        this.projects = mergeIncomingProjects(this.projects, incomingProjects, this.runtimeWatches);
        if (this.selectedId && !this.projects.some((project) => project.id === this.selectedId)) {
          this.selectedId = this.projects[0]?.id ?? "";
        }
        if (!this.selectedId && this.projects[0]) this.selectedId = this.projects[0].id;
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return false;
      } finally {
        if (!options.silent) this.loading = false;
        this.refreshing = false;
      }
    },
    async refreshProject(projectId: string): Promise<Project | undefined> {
      try {
        const project = await getProject(projectId);
        const index = this.projects.findIndex((item) => item.id === projectId);
        if (index >= 0) {
          this.projects = this.projects.map((item) => (item.id === projectId ? project : item));
        } else {
          this.projects = [...this.projects, project];
        }
        this.error = "";
        return project;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      }
    },
    select(projectId: string) {
      this.selectedId = projectId;
      this.error = "";
      this.clearLogs();
      this.context = null;
    },
    async runCommand(commandId: string, projectId?: string): Promise<ProcessRun | undefined> {
      const project = projectId ? this.projects.find((item) => item.id === projectId) : this.selectedProject;
      if (!project) return;
      const actionKey = commandActionKey(project.id, commandId);
      this.commandActions[actionKey] = "starting";
      this.error = "";
      try {
        const result = await startCommand(project.id, commandId);
        if (result.run.status === "running") this.watchRun(project.id, result.run.id);
        this.applyRun(project.id, result.run);
        this.logs = "";
        this.logsRunId = result.run.id;
        await this.loadLogs(result.run.id, project.id);
        const refreshedProject = await this.refreshProject(project.id);
        const refreshedRun = refreshedProject?.lastRun;
        if (refreshedRun?.id === result.run.id && refreshedRun.status !== "running") {
          this.unwatchRun(project.id, result.run.id);
          await this.loadLogs(result.run.id, project.id);
          return refreshedRun;
        }
        if (result.run.status === "running" && (!refreshedRun || refreshedRun.id !== result.run.id)) {
          this.applyRun(project.id, result.run);
        }
        if (result.run.status !== "running") {
          this.unwatchRun(project.id, result.run.id);
          await this.loadLogs(result.run.id, project.id);
        }
        return result.run;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      } finally {
        delete this.commandActions[actionKey];
      }
    },
    async stop(runId: string, projectId?: string): Promise<boolean> {
      const targetProjectId = projectId ?? this.selectedProject?.id;
      if (!targetProjectId) return false;
      const project = this.projects.find((item) => item.id === targetProjectId);
      const commandId = project?.lastRun?.id === runId ? project.lastRun.commandId : undefined;
      const actionKey = commandId ? commandActionKey(targetProjectId, commandId) : undefined;
      if (actionKey) this.commandActions[actionKey] = "stopping";
      this.error = "";
      try {
        const result = await stopProcess(targetProjectId, runId);
        if (result.run) {
          this.applyRun(targetProjectId, result.run);
        } else if (project?.lastRun?.id === runId) {
          this.applyRun(targetProjectId, {
            ...project.lastRun,
            status: "stopped",
            exitedAt: new Date().toISOString()
          });
        }
        if (!result.stopped) {
          const message = "当前命令不再由 Dev Cockpit 托管，已清理旧运行状态。若端口仍被占用，请在系统终端关闭对应进程。";
          await this.refreshProject(targetProjectId);
          this.unwatchRun(targetProjectId, runId);
          this.error = message;
          return false;
        }
        await this.refreshProject(targetProjectId);
        this.unwatchRun(targetProjectId, runId);
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return false;
      } finally {
        if (actionKey) delete this.commandActions[actionKey];
      }
    },
    async stopPort(port: number, projectId?: string): Promise<StopPortResponse | undefined> {
      const targetProjectId = projectId ?? this.selectedProject?.id;
      if (!targetProjectId) return undefined;
      const actionKey = portActionKey(targetProjectId, port);
      this.portActions[actionKey] = "stopping";
      this.error = "";
      try {
        const result = await stopPortRequest(targetProjectId, port);
        await this.refreshProject(targetProjectId);
        if (!result.stopped) {
          this.error = result.error || `未能停止端口 ${port}`;
          return result;
        }
        return result;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      } finally {
        delete this.portActions[actionKey];
      }
    },
    async loadLogs(runId?: string, projectId?: string) {
      const project = projectId ? this.projects.find((item) => item.id === projectId) : this.selectedProject;
      const targetRun = runId ?? project?.lastRun?.id;
      if (!project || !targetRun) {
        this.clearLogs();
        return;
      }
      const targetProjectId = project.id;
      try {
        const logs = await getLogs(targetProjectId, targetRun);
        if (this.selectedId === targetProjectId) {
          this.logs = logs;
          this.logsRunId = targetRun;
          this.error = "";
        }
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
      }
    },
    clearLogs() {
      this.logs = "";
      this.logsRunId = "";
    },
    async loadContext(projectId?: string): Promise<ContextResponse | undefined> {
      const project = projectId ? this.projects.find((item) => item.id === projectId) : this.selectedProject;
      if (!project) return;
      try {
        const context = await getContext(project.id);
        if (!projectId || project.id === this.selectedId) {
          this.context = context;
        }
        this.error = "";
        return context;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      }
    },
    async writeContextFiles(): Promise<WriteContextResponse | undefined> {
      const project = this.selectedProject;
      if (!project) return;
      try {
        const result = await writeContext(project.id);
        this.error = "";
        return result;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return undefined;
      }
    },
    async openProjectFolder(projectId?: string): Promise<boolean> {
      const project = projectId ? this.projects.find((item) => item.id === projectId) : this.selectedProject;
      if (!project) return false;
      try {
        await openProjectFolderRequest(project.id);
        this.error = "";
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return false;
      }
    },
    async openProjectEditor(projectId?: string): Promise<boolean> {
      const project = projectId ? this.projects.find((item) => item.id === projectId) : this.selectedProject;
      if (!project) return false;
      try {
        await openProjectEditorRequest(project.id);
        this.error = "";
        return true;
      } catch (error) {
        this.error = error instanceof Error ? error.message : String(error);
        return false;
      }
    },
    commandAction(projectId: string, commandId: string): CommandActionState | undefined {
      return this.commandActions[commandActionKey(projectId, commandId)];
    },
    portAction(projectId: string, port: number): PortActionState | undefined {
      return this.portActions[portActionKey(projectId, port)];
    },
    watchRun(projectId: string, runId: string) {
      this.runtimeWatches = { ...this.runtimeWatches, [projectId]: runId };
    },
    unwatchRun(projectId: string, runId?: string) {
      if (runId && this.runtimeWatches[projectId] !== runId) return;
      const next = { ...this.runtimeWatches };
      delete next[projectId];
      this.runtimeWatches = next;
    },
    pruneRuntimeWatches() {
      for (const [projectId, runId] of Object.entries(this.runtimeWatches)) {
        const project = this.projects.find((item) => item.id === projectId);
        const run = project?.lastRun;
        if (!run || run.id !== runId || run.status !== "running") {
          this.unwatchRun(projectId, runId);
        }
      }
    },
    applyRun(projectId: string, run: ProcessRun) {
      this.projects = this.projects.map((project) => (project.id === projectId ? { ...project, lastRun: run, lastError: undefined } : project));
    }
  }
});

function commandActionKey(projectId: string, commandId: string): string {
  return `${projectId}:${commandId}`;
}

function portActionKey(projectId: string, port: number): string {
  return `${projectId}:port:${port}`;
}

function mergeIncomingProjects(currentProjects: Project[], incomingProjects: Project[], runtimeWatches: Record<string, string>): Project[] {
  const currentById = new Map(currentProjects.map((project) => [project.id, project]));
  return incomingProjects.map((incoming) => {
    const current = currentById.get(incoming.id);
    const watchedRunId = runtimeWatches[incoming.id];
    const currentRun = current?.lastRun;
    if (!current || !currentRun || currentRun.status !== "running" || currentRun.id !== watchedRunId) return incoming;
    if (incoming.lastRun?.id === currentRun.id && incoming.lastRun.status === "running") return incoming;

    return {
      ...incoming,
      ports: mergeRuntimePorts(incoming.ports, current.ports),
      lastRun: currentRun,
      lastError: current.lastError
    };
  });
}

function mergeRuntimePorts(incomingPorts: PortStatus[], currentPorts: PortStatus[]): PortStatus[] {
  const ports = new Map(incomingPorts.map((port) => [portKey(port), port]));
  for (const port of currentPorts) {
    if (port.status === "open" && port.source !== "common") {
      ports.set(portKey(port), port);
    }
  }
  return [...ports.values()].sort((left, right) => left.port - right.port || (left.host ?? "").localeCompare(right.host ?? ""));
}

function portKey(port: PortStatus): string {
  return `${port.host ?? ""}:${port.port}:${port.source}`;
}
