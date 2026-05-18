export type ProjectKind = "node" | "python" | "go" | "rust" | "docker" | "mixed" | "unknown";

export type CommandKind = "dev" | "test" | "build" | "start" | "custom";

export type CommandSource = "package-script" | "detected" | "user";

export type ProcessStatus = "running" | "exited" | "failed" | "stopped";

/**
 * Minimal Git summary shown in the dashboard. Implementations should treat
 * missing Git metadata as a normal state because scanned folders may not be
 * healthy repositories.
 */
export interface GitInfo {
  branch: string;
  dirtyCount: number;
  lastCommit?: string;
}

/**
 * A command is always represented as an executable plus arguments. This keeps
 * process execution cross-platform and avoids shell string interpolation.
 */
export interface Command {
  id: string;
  label: string;
  command: string;
  args: string[];
  cwd: string;
  source: CommandSource;
  kind: CommandKind;
}

export interface PortStatus {
  port: number;
  /**
   * Optional host reported by a running process, for example localhost,
   * 127.0.0.1, or ::1. Keeping it separate prevents two local services on the
   * same numeric port but different bind hosts from being shown as one thing.
   */
  host?: string;
  url?: string;
  status: "open" | "closed" | "unknown";
  source: "detected" | "process" | "common";
}

export interface ErrorSummary {
  message: string;
  commandId?: string;
  occurredAt: string;
}

export interface ProcessRun {
  id: string;
  projectId: string;
  commandId: string;
  status: ProcessStatus;
  startedAt: string;
  exitedAt?: string;
  exitCode?: number;
  logPath: string;
}

export interface Project {
  id: string;
  name: string;
  path: string;
  kind: ProjectKind;
  packageManager?: "npm" | "pnpm" | "yarn" | "bun";
  git: GitInfo;
  commands: Command[];
  ports: PortStatus[];
  lastRun?: ProcessRun;
  lastError?: ErrorSummary;
  markers: string[];
}

export interface RecoveryCard {
  title: string;
  summary: string;
  nextStep: string;
  facts: Array<{ label: string; value: string; tone?: "normal" | "good" | "warn" | "danger" }>;
}

export interface ScanOptions {
  maxDepth?: number;
  maxProjects?: number;
  timeoutMs?: number;
  ignoreNames?: string[];
}

export interface ScanResult {
  root: string;
  projects: Project[];
  warnings: string[];
  scannedAt: string;
}
