import type { FailureRule } from "./types.js";
import { extractHost, extractKillCommand, extractLocalUrl, extractPid, extractPort, formatEndpoint } from "./utils.js";

export const summarizePortConflictFailure: FailureRule = ({ rawLog, exitCode }) => {
  const nextDuplicate = /Another next dev server is already running/i.test(rawLog);
  const conflictText = nextDuplicate ? rawLog.split(/Another next dev server is already running/i).at(-1) ?? rawLog : rawLog;
  const port = extractPort(conflictText) ?? extractPort(rawLog);
  const url = nextDuplicate
    ? extractLocalUrl(conflictText, "last") ?? (port ? `http://localhost:${port}` : extractLocalUrl(rawLog, "last"))
    : extractLocalUrl(conflictText);
  const pid = extractPid(conflictText) ?? extractPid(rawLog);
  const killCommand = extractKillCommand(conflictText) ?? extractKillCommand(rawLog);
  const hasGenericConflict =
    /EADDRINUSE|address already in use|winerror 10048|通常每个套接字地址|only one usage|Port \d+ is in use/i.test(rawLog);

  if (!nextDuplicate && !hasGenericConflict) return undefined;

  if (nextDuplicate) {
    return [
      `检测到已有 Next.js dev server 正在运行：${url ?? formatEndpoint(undefined, port)}。`,
      pid ? `占用进程 PID：${pid}。` : "未从日志中识别到 PID。",
      "这通常不是项目启动失败，而是重复启动。请直接打开已有地址；如果需要重启，请先在概况页停止对应端口，或关闭占用进程。",
      killCommand ? `可运行：${killCommand}。` : port ? `Windows 可先运行：netstat -ano | findstr :${port}。` : "",
      `(exit code ${exitCode ?? "unknown"})`
    ]
      .filter(Boolean)
      .join(" ");
  }

  return [
    `端口已被占用：${url ?? formatEndpoint(extractHost(rawLog), port)}。`,
    pid ? `占用进程 PID：${pid}。` : "日志未提供占用进程 PID。",
    "请先确认该地址是否已经可访问；如果要重新启动，请在概况页停止/清理该端口，或关闭占用该端口的外部进程。",
    killCommand ? `可运行：${killCommand}。` : port ? `Windows 可先运行：netstat -ano | findstr :${port}。` : "",
    `(exit code ${exitCode ?? "unknown"})`
  ]
    .filter(Boolean)
    .join(" ");
};
