import type { Command, PortStatus, Project } from "@local-dev-cockpit/core";

export function commandStartBlockReason(project: Project, command: Command): string | undefined {
  if (project.lastRun?.status === "running") {
    return project.lastRun.commandId === command.id
      ? "该命令已经在运行，请使用停止按钮结束它。"
      : "该项目已有命令正在运行，请先停止当前命令。";
  }

  const openPorts = project.ports.filter((port) => port.status === "open" && port.source !== "common");
  if (commandWouldTouchPorts(command, openPorts)) {
    return "服务已经在线，已阻止重复启动。需要重启时请先停止当前端口。";
  }

  const stalePorts = project.ports.filter((port) => port.status === "unknown" && port.source === "detected");
  if (commandWouldTouchPorts(command, stalePorts)) {
    return "检测到残留端口占用，已阻止启动。请先清理端口后再运行。";
  }

  return undefined;
}

function commandWouldTouchPorts(command: Command, ports: PortStatus[]): boolean {
  if (ports.length === 0) return false;
  const declaredPorts = commandDeclaredPorts(command);
  if (declaredPorts.length > 0) return declaredPorts.some((port) => ports.some((item) => item.port === port));
  return command.kind === "dev" || command.kind === "start";
}

function commandDeclaredPorts(command: Command): number[] {
  const ports = new Set<number>(command.ports ?? []);
  const text = `${command.command} ${command.args.join(" ")}`;
  const patterns = [
    /(?:--(?:port|server\.port)(?:=|\s+)|-p\s+|(?:^|\s)[A-Z_]*PORT=)(\d{2,5})/gi,
    /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port);
    }
  }
  return [...ports];
}
