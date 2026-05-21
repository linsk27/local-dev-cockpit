import { type ErrorSummary, type PortStatus, type ProcessRun, type Project } from "@local-dev-cockpit/core";
import type { ProcessManager } from "../../process-manager.js";

export function normalizeManagedRun(lastRun: ProcessRun | undefined, processManager: ProcessManager): ProcessRun | undefined {
  if (!lastRun || lastRun.status !== "running" || processManager.isRunning(lastRun.id)) return lastRun;
  return {
    ...lastRun,
    status: "stopped",
    exitedAt: lastRun.exitedAt ?? new Date().toISOString()
  };
}

export function hydrateLastRun(lastRun: ProcessRun | undefined, processPorts: PortStatus[]): ProcessRun | undefined {
  if (!lastRun || lastRun.status !== "running" || processPorts.length === 0) return lastRun;
  if (processPorts.some((port) => port.status === "open")) return lastRun;
  return {
    ...lastRun,
    status: "stopped",
    exitedAt: lastRun.exitedAt ?? new Date().toISOString()
  };
}

export function isStaleError(lastRun: ProcessRun | undefined, lastError: ErrorSummary | undefined): boolean {
  if (!lastRun || !lastError) return false;
  if (lastRun.status === "failed") return false;
  return new Date(lastRun.startedAt).getTime() >= new Date(lastError.occurredAt).getTime();
}

export function isObsoleteMissingToolFailure(project: Project, lastRun: ProcessRun | undefined, lastError: ErrorSummary | undefined): boolean {
  if (lastRun?.status !== "failed" || !lastError?.commandId) return false;
  const currentCommand = project.commands.find((command) => command.id === lastError.commandId);
  if (!currentCommand) return true;
  const missingTool = parseMissingToolName(lastError.message);
  return Boolean(missingTool && missingTool !== currentCommand.command.toLowerCase());
}

export function parseMissingToolName(message: string): string | undefined {
  const quoted = message.match(
    /['"`]?(npm|npx|pnpm|yarn|bun)(?:\.cmd)?['"`]?\s+(?:不是内部或外部命令|is not recognized|not found|未安装|不在 PATH)/i
  );
  return quoted?.[1]?.toLowerCase();
}
