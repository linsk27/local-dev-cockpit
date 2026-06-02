import { NodeProcessAdapter, type Project } from "@local-dev-cockpit/core";

export interface StopPortResult {
  stopped: boolean;
  port: number;
  pids: number[];
  alreadyClosed?: boolean;
  error?: string;
}

interface StopPidResult {
  ok: boolean;
  message: string;
}

/**
 * Stops the process tree that owns a listening port. The operation is defensive:
 * it refuses to stop Dev Cockpit itself and treats already-closed stale port
 * rows as a successful cleanup.
 */
export async function stopPort(port: number): Promise<StopPortResult> {
  const processAdapter = new NodeProcessAdapter();
  const pids = await findListeningPidsByPort(processAdapter, port);
  const killablePids = pids.filter((pid) => pid > 0 && pid !== process.pid);
  if (killablePids.length === 0) {
    if (pids.includes(process.pid)) {
      return { stopped: false, port, pids, error: "Dev Cockpit 不会停止自身进程。" };
    }
    const stillOpen = await processAdapter.isPortOpen(port);
    if (!stillOpen) {
      return { stopped: true, port, pids, alreadyClosed: true };
    }
    return {
      stopped: false,
      port,
      pids,
      error: "端口仍在监听，但 Dev Cockpit 没有找到可停止的所属进程。请关闭启动它的终端，或用管理员权限重试。"
    };
  }

  const failures: string[] = [];
  const actions: string[] = [];
  for (const pid of killablePids) {
    const result =
      process.platform === "win32"
        ? await stopWindowsPid(processAdapter, pid)
        : await stopUnixPid(processAdapter, pid);
    if (result.ok) {
      actions.push(result.message);
    } else {
      failures.push(result.message);
    }
  }

  await new Promise((resolve) => setTimeout(resolve, 800));
  const stillOpen = await processAdapter.isPortOpen(port);
  if (!stillOpen) {
    return {
      stopped: true,
      port,
      pids: killablePids,
      alreadyClosed: failures.length > 0
    };
  }

  return {
    stopped: false,
    port,
    pids: killablePids,
    error:
      failures.length > 0
        ? failures.join("\n")
        : [...actions, "端口仍在监听。父进程可能不可见，或由系统代理托管；请关闭启动它的终端，或用管理员权限重试 Dev Cockpit。"].join("\n")
  };
}

export function projectPortCanBeStopped(project: Project, port: number): boolean {
  return project.ports.some(
    (item) =>
      item.port === port &&
      (item.status === "open" || (item.status === "unknown" && item.source === "detected"))
  );
}

async function stopWindowsPid(processAdapter: NodeProcessAdapter, pid: number): Promise<StopPidResult> {
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$targetPid = ${pid}`,
    "$targetProcess = Get-Process -Id $targetPid -ErrorAction SilentlyContinue",
    "$children = @(Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq $targetPid -and $_.Name -ne 'conhost.exe' })",
    "if ($targetProcess) { Stop-Process -Id $targetPid -Force -ErrorAction Stop; Write-Output 'STOPPED_TARGET'; exit 0 }",
    "if ($children.Count -eq 0) { Write-Output 'PID_NOT_FOUND'; exit 2 }",
    "$childPids = @($children | Select-Object -ExpandProperty ProcessId)",
    "foreach ($childPid in $childPids) { Stop-Process -Id $childPid -Force -ErrorAction SilentlyContinue }",
    "Write-Output ('STOPPED_CHILDREN:' + ($childPids -join ','))"
  ].join("; ");
  const result = await processAdapter.execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeoutMs: 6000
  });
  const stoppedChildren = parseStoppedChildrenOutput(result.stdout);
  if (stoppedChildren.length > 0) {
    return {
      ok: true,
      message: `Windows 端口父进程 PID ${pid} 不可见，已尝试停止可见子进程 ${stoppedChildren.join(", ")}。`
    };
  }
  if (result.exitCode === 0) return { ok: true, message: `Stopped PID ${pid}` };
  if (result.stdout.includes("PID_NOT_FOUND")) {
    return {
      ok: false,
      message: `Windows 报告端口属于 PID ${pid}，但系统进程列表中找不到该进程，也没有可停止的可见子进程；可能是权限不足、进程已退出但端口表未刷新，或该端口由系统代理托管。`
    };
  }
  return { ok: false, message: result.stderr || result.stdout || `停止 PID ${pid} 失败` };
}

export function parseStoppedChildrenOutput(output: string): number[] {
  const match = output.match(/STOPPED_CHILDREN:([0-9,\s]+)/);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((pid) => Number.isInteger(pid) && pid > 0);
}

async function stopUnixPid(processAdapter: NodeProcessAdapter, pid: number): Promise<StopPidResult> {
  const result = await processAdapter.execFile("kill", ["-TERM", String(pid)], { timeoutMs: 6000 });
  if (result.exitCode === 0) return { ok: true, message: `Stopped PID ${pid}` };
  return { ok: false, message: result.stderr || result.stdout || `停止 PID ${pid} 失败` };
}

async function findListeningPidsByPort(processAdapter: NodeProcessAdapter, port: number): Promise<number[]> {
  if (process.platform === "win32") {
    const result = await processAdapter.execFile("netstat.exe", ["-ano"], { timeoutMs: 6000 });
    return parseNetstatListeningPids(result.stdout, port);
  }
  const result = await processAdapter.execFile("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], { timeoutMs: 6000 });
  return [...new Set(result.stdout.split(/\r?\n/).map((line) => Number(line.trim())).filter((pid) => Number.isInteger(pid) && pid > 0))];
}

export function parseNetstatListeningPids(output: string, port: number): number[] {
  const pids = new Set<number>();
  for (const line of output.split(/\r?\n/)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length < 5 || columns[0]?.toUpperCase() !== "TCP") continue;
    const localAddress = columns[1] ?? "";
    const state = columns[3] ?? "";
    const pid = Number(columns[4]);
    if (state.toUpperCase() === "LISTENING" && addressUsesPort(localAddress, port) && Number.isInteger(pid)) {
      pids.add(pid);
    }
  }
  return [...pids];
}

function addressUsesPort(address: string, port: number): boolean {
  return address.endsWith(`:${port}`) || address.endsWith(`]:${port}`);
}
