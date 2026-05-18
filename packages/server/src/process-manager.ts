import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createWriteStream, promises as fs } from "node:fs";
import path from "node:path";
import type { Command, ErrorSummary, ProcessRun } from "@local-dev-cockpit/core";
import type { AppPaths } from "./paths.js";
import type { JsonStore } from "./store.js";
import type { EventBus } from "./events.js";
import { decodeProcessChunk, stripAnsiControlSequences } from "./log-decoder.js";

interface RunningProcess {
  run: ProcessRun;
  child: ChildProcessWithoutNullStreams;
  buffer: string[];
}

const WINDOWS_COMMAND_SHIMS = new Set(["npm", "npx", "pnpm", "yarn", "bun"]);

/**
 * Owns child-process lifecycle. It intentionally accepts structured commands
 * only, so callers cannot smuggle shell-composed strings into execution.
 */
export class ProcessManager {
  private readonly running = new Map<string, RunningProcess>();

  constructor(
    private readonly paths: AppPaths,
    private readonly store: JsonStore,
    private readonly events: EventBus
  ) {}

  async start(projectId: string, command: Command): Promise<ProcessRun> {
    await fs.mkdir(this.paths.logsDir, { recursive: true });
    const runId = `${projectId}-${Date.now()}`;
    const logPath = path.join(this.paths.logsDir, `${runId}.log`);
    const logStream = createWriteStream(logPath, { flags: "a", encoding: "utf8" });
    const run: ProcessRun = {
      id: runId,
      projectId,
      commandId: command.id,
      status: "running",
      startedAt: new Date().toISOString(),
      logPath
    };

    let child: ChildProcessWithoutNullStreams;
    try {
      const invocation = createSpawnInvocation(command.command, command.args);
      child = spawn(invocation.command, invocation.args, {
        cwd: command.cwd,
        windowsHide: true,
        shell: false,
        env: process.env
      });
    } catch (error) {
      const message = `Failed to start command: ${error instanceof Error ? error.message : String(error)}`;
      const occurredAt = new Date().toISOString();
      run.status = "failed";
      run.exitCode = 1;
      run.exitedAt = occurredAt;
      logStream.write(`[dev-cockpit] ${message}\n`);
      logStream.end();
      await this.store.recordRun(run);
      await this.store.recordError(projectId, { message, commandId: command.id, occurredAt });
      this.events.emit("process.closed", { run });
      return run;
    }

    const entry: RunningProcess = { run, child, buffer: [] };
    this.running.set(runId, entry);
    await this.store.recordRun(run);
    this.events.emit("process.started", { run, command });

    const append = (chunk: Buffer) => {
      const text = decodeProcessChunk(chunk);
      logStream.write(text);
      entry.buffer.push(text);
      if (entry.buffer.length > 400) entry.buffer.splice(0, entry.buffer.length - 400);
      this.events.emit("process.log", { runId, projectId, text });
    };

    child.stdout.on("data", append);
    child.stderr.on("data", append);
    let finished = false;
    child.once("error", async (error) => {
      if (finished) return;
      finished = true;
      const occurredAt = new Date().toISOString();
      const message = `Failed to start command: ${error.message}`;
      append(Buffer.from(`[dev-cockpit] ${message}\n`, "utf8"));
      run.status = "failed";
      run.exitCode = 1;
      run.exitedAt = occurredAt;
      logStream.end();
      this.running.delete(runId);
      const summary: ErrorSummary = { message, commandId: command.id, occurredAt };
      await this.store.recordRun(run);
      await this.store.recordError(projectId, summary);
      this.events.emit("process.error", { runId, projectId, error: summary });
      this.events.emit("process.closed", { run });
    });
    child.once("close", async (exitCode) => {
      if (finished) return;
      finished = true;
      run.status = run.status === "stopped" ? "stopped" : exitCode === 0 ? "exited" : "failed";
      run.exitCode = exitCode ?? undefined;
      run.exitedAt = new Date().toISOString();
      logStream.end();
      this.running.delete(runId);
      await this.store.recordRun(run);
      if (run.status === "failed") {
        await this.store.recordError(projectId, {
          message: `Command exited with code ${exitCode}`,
          commandId: command.id,
          occurredAt: run.exitedAt
        });
      }
      this.events.emit("process.closed", { run });
    });

    return run;
  }

  async stop(processId: string): Promise<ProcessRun | undefined> {
    const entry = this.running.get(processId);
    if (!entry) return undefined;
    entry.run.status = "stopped";
    entry.run.exitedAt = new Date().toISOString();
    await killProcessTree(entry.child);
    this.running.delete(processId);
    await this.store.recordRun(entry.run);
    this.events.emit("process.stopped", { run: entry.run });
    return entry.run;
  }

  isRunning(processId: string): boolean {
    return this.running.has(processId);
  }

  async readLogs(runId: string): Promise<string> {
    const live = this.running.get(runId);
    if (live) return stripAnsiControlSequences(live.buffer.join(""));
    const logPath = path.join(this.paths.logsDir, `${runId}.log`);
    try {
      return stripAnsiControlSequences(await fs.readFile(logPath, "utf8"));
    } catch {
      return "";
    }
  }
}

async function killProcessTree(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (process.platform === "win32" && child.pid) {
    await new Promise<void>((resolve) => {
      const killer = spawn("taskkill.exe", ["/pid", String(child.pid), "/t", "/f"], {
        windowsHide: true,
        stdio: "ignore"
      });
      killer.once("error", () => resolve());
      killer.once("close", () => resolve());
    });
    return;
  }

  child.kill();
}

function createSpawnInvocation(command: string, args: string[]): { command: string; args: string[] } {
  if (process.platform !== "win32") return { command, args };
  const lower = command.toLowerCase();
  if (!WINDOWS_COMMAND_SHIMS.has(lower) && !lower.endsWith(".cmd") && !lower.endsWith(".bat")) {
    return { command, args };
  }
  const shim = lower.endsWith(".cmd") || lower.endsWith(".bat") ? command : `${command}.cmd`;
  return { command: "cmd.exe", args: ["/d", "/s", "/c", shim, ...args] };
}
