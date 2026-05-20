import type { Command, PortStatus, Project } from "@local-dev-cockpit/core";

type StatusReasonLocale = "zh-CN" | "en-US";
export type ProjectRuntimeMode = "managed-running" | "detected-online" | "stale" | "failed" | "idle";

export interface ProjectDiagnosticItem {
  id: "command" | "package-manager" | "ports" | "failure" | "next";
  label: string;
  value: string;
  detail: string;
  tone: "normal" | "good" | "warn" | "danger";
}

export function visibleProjectPorts(project: Project): PortStatus[] {
  return project.ports.filter((port) => port.status === "open" && port.source !== "common");
}

export function runningProjectPorts(project: Project): PortStatus[] {
  return project.ports.filter((port) => port.status === "open" && port.source === "process");
}

export function detectedProjectPorts(project: Project): PortStatus[] {
  return project.ports.filter((port) => port.status === "open" && port.source === "detected");
}

export function staleProjectPorts(project: Project): PortStatus[] {
  return project.ports.filter((port) => port.status === "unknown" && port.source === "detected");
}

export function projectHasStalePorts(project: Project): boolean {
  return visibleProjectPorts(project).length === 0 && staleProjectPorts(project).length > 0;
}

export function commandWouldReuseOpenPort(project: Project, command: Command): boolean {
  if (project.lastRun?.status === "running") return false;
  const openPorts = visibleProjectPorts(project);
  if (openPorts.length === 0) return false;
  const declaredPorts = commandDeclaredPorts(command);
  if (declaredPorts.length > 0) return declaredPorts.some((port) => openPorts.some((item) => item.port === port));
  return command.kind === "dev" || command.kind === "start";
}

export function commandBlockedByStalePort(project: Project, command: Command): boolean {
  if (project.lastRun?.status === "running") return false;
  const stalePorts = staleProjectPorts(project);
  if (stalePorts.length === 0) return false;
  const declaredPorts = commandDeclaredPorts(command);
  if (declaredPorts.length > 0) return declaredPorts.some((port) => stalePorts.some((item) => item.port === port));
  return command.kind === "dev" || command.kind === "start";
}

export function projectIsOnline(project: Project): boolean {
  return project.lastRun?.status === "running" || visibleProjectPorts(project).length > 0;
}

export function projectRuntimeMode(project: Project): ProjectRuntimeMode {
  if (project.lastRun?.status === "running") return "managed-running";
  if (visibleProjectPorts(project).length > 0) return "detected-online";
  if (projectHasStalePorts(project)) return "stale";
  if (projectHasFailed(project)) return "failed";
  return "idle";
}

export function runtimeSourceLabel(project: Project, locale: StatusReasonLocale = "zh-CN"): string {
  const mode = projectRuntimeMode(project);
  if (locale === "en-US") {
    const labels: Record<ProjectRuntimeMode, string> = {
      "managed-running": "Managed by Dev Cockpit",
      "detected-online": "Detected from system",
      stale: "Port needs cleanup",
      failed: "Last command failed",
      idle: "No service online"
    };
    return labels[mode];
  }
  const labels: Record<ProjectRuntimeMode, string> = {
    "managed-running": "Dev Cockpit 托管",
    "detected-online": "系统外部检测",
    stale: "端口需清理",
    failed: "上次命令失败",
    idle: "当前无服务"
  };
  return labels[mode];
}

export function projectStatusReason(project: Project, locale: StatusReasonLocale = "zh-CN"): string {
  const openPorts = visibleProjectPorts(project);
  const stalePorts = staleProjectPorts(project);
  if (project.lastRun?.status === "running" && openPorts.length > 0) {
    return locale === "en-US"
      ? `Started by Dev Cockpit, endpoint detected: ${openPorts.map(formatPortEndpoint).join(", ")}`
      : `由 Dev Cockpit 启动，已检测到 ${openPorts.map(formatPortEndpoint).join(", ")}`;
  }
  if (project.lastRun?.status === "running") {
    return locale === "en-US"
      ? "Started by Dev Cockpit; waiting for the framework to print a reachable endpoint."
      : "由 Dev Cockpit 启动，正在等待框架输出可访问地址。";
  }
  if (openPorts.length > 0) {
    return locale === "en-US"
      ? `Detected an existing local service for this project: ${openPorts.map(formatPortEndpoint).join(", ")}`
      : `系统检测到该项目已有本地服务：${openPorts.map(formatPortEndpoint).join(", ")}`;
  }
  if (stalePorts.length > 0) {
    return locale === "en-US"
      ? `Port is occupied but HTTP is unreachable: ${stalePorts.map(formatPortEndpoint).join(", ")}`
      : `检测到端口占用但 HTTP 不可访问：${stalePorts.map(formatPortEndpoint).join(", ")}`;
  }
  if (project.lastError) {
    return locale === "en-US" ? `Last command failed: ${project.lastError.message}` : `上次命令失败：${project.lastError.message}`;
  }
  if (project.commands.length > 0) {
    return locale === "en-US" ? "Runnable commands detected; no online service right now." : "已识别可运行命令，当前没有在线服务。";
  }
  return locale === "en-US" ? "No runnable commands detected." : "未识别到可运行命令。";
}

export function projectDiagnostics(project: Project, locale: StatusReasonLocale = "zh-CN"): ProjectDiagnosticItem[] {
  return [
    commandSourceDiagnostic(project, locale),
    packageManagerDiagnostic(project, locale),
    portSourceDiagnostic(project, locale),
    failureDiagnostic(project, locale),
    nextActionDiagnostic(project, locale)
  ];
}

export function projectHasFailed(project: Project): boolean {
  if (visibleProjectPorts(project).length > 0) return false;
  if (projectHasStalePorts(project)) return false;
  if (projectHasAlreadyRunningConflict(project)) return false;
  return Boolean(project.lastError) || project.lastRun?.status === "failed";
}

export function projectHasAlreadyRunningConflict(project: Project): boolean {
  const message = project.lastError?.message ?? "";
  return (
    visibleProjectPorts(project).length > 0 &&
    /another .+server.+already running|address.*already in use|eaddrinuse|only one usage|通常每个套接字|port \d+ is in use/i.test(message)
  );
}

export function recommendedProjectCommand(project: Project): Command | undefined {
  const failedCommand = project.lastError?.commandId
    ? project.commands.find((command) => command.id === project.lastError?.commandId)
    : undefined;
  return (
    failedCommand ??
    project.commands.find((command) => command.kind === "dev") ??
    project.commands.find((command) => command.kind === "start") ??
    project.commands[0]
  );
}

export function noCommandGuidance(project: Project, locale: StatusReasonLocale = "zh-CN"): string {
  const hasMarker = (...markers: string[]) => markers.some((marker) => project.markers.includes(marker));
  const isEnglish = locale === "en-US";

  if (project.kind === "node" || hasMarker("package.json")) {
    return isEnglish
      ? "package.json was found but no runnable scripts were detected. Add a dev/start script, or choose a more specific app directory."
      : "检测到 package.json，但没有可运行 scripts。请添加 dev/start 脚本，或选择更具体的应用目录。";
  }

  if (project.kind === "python" || hasMarker("requirements.txt", "pyproject.toml")) {
    if (hasMarker("requirements.txt", "pyproject.toml")) {
      return isEnglish
        ? "Python dependencies were found, but no app entrypoint was detected. Add manage.py, app.py, main.py, app/main.py, src/app/main.py, or choose the backend directory."
        : "检测到 Python 依赖文件，但没有识别到应用入口。请确认有 manage.py、app.py、main.py、app/main.py、src/app/main.py，或选择真正的后端目录。";
    }
    return isEnglish
      ? "Python project detected, but no supported entrypoint was found. Add a common entry file or run doctor on the backend directory."
      : "检测到 Python 项目，但没有支持的入口文件。请添加常见入口，或对后端目录运行 doctor。";
  }

  if (project.kind === "docker" || hasMarker("Dockerfile")) {
    return isEnglish
      ? "Docker markers were found, but no compose command was detected. Add docker-compose.yml/compose.yml for one-click startup."
      : "检测到 Docker 标记，但没有 compose 启动命令。建议添加 docker-compose.yml 或 compose.yml，方便一键启动。";
  }

  if (project.kind === "unknown") {
    return isEnglish
      ? "This looks like a repository shell without a known app marker. Select a child app folder such as frontend, backend, apps, packages, or services."
      : "这更像仓库外壳，未发现已支持的应用标记。请选择 frontend、backend、apps、packages、services 等子项目目录。";
  }

  return isEnglish
    ? "No runnable command has been detected for this project yet. Check entry files or add a more specific root directory."
    : "暂未识别到可运行命令。请检查项目入口文件，或添加更具体的根目录。";
}

function commandSourceDiagnostic(project: Project, locale: StatusReasonLocale): ProjectDiagnosticItem {
  const labels = diagnosticLabels(locale);
  if (project.commands.length === 0) {
    return {
      id: "command",
      label: labels.commandSource,
      value: labels.none,
      detail: noCommandGuidance(project, locale),
      tone: "warn"
    };
  }

  const sourceLabels = new Map<Command["source"], string>([
    ["package-script", labels.packageScripts],
    ["detected", labels.detectedCommands],
    ["user", labels.userCommands]
  ]);
  const sources = [...new Set(project.commands.map((command) => command.source))].map((source) => sourceLabels.get(source) ?? source);
  const recommended = recommendedProjectCommand(project);
  return {
    id: "command",
    label: labels.commandSource,
    value: sources.join(" + "),
    detail: recommended ? labels.recommendedCommand(commandDisplay(recommended)) : labels.commandCount(project.commands.length),
    tone: "good"
  };
}

function packageManagerDiagnostic(project: Project, locale: StatusReasonLocale): ProjectDiagnosticItem {
  const labels = diagnosticLabels(locale);
  if (project.kind !== "node") {
    return {
      id: "package-manager",
      label: labels.packageManager,
      value: labels.notNodeProject,
      detail: labels.notNodeDetail,
      tone: "normal"
    };
  }
  if (!project.packageManager) {
    return {
      id: "package-manager",
      label: labels.packageManager,
      value: labels.unknown,
      detail: labels.packageUnknownDetail,
      tone: "warn"
    };
  }
  return {
    id: "package-manager",
    label: labels.packageManager,
    value: project.packageManager,
    detail: labels.packageManagerDetail,
    tone: "good"
  };
}

function portSourceDiagnostic(project: Project, locale: StatusReasonLocale): ProjectDiagnosticItem {
  const labels = diagnosticLabels(locale);
  const processPorts = runningProjectPorts(project);
  const detectedPorts = detectedProjectPorts(project);
  const stalePorts = staleProjectPorts(project);
  if (processPorts.length > 0) {
    return {
      id: "ports",
      label: labels.portSource,
      value: labels.managedProcess,
      detail: processPorts.map(formatPortEndpoint).join(", "),
      tone: "good"
    };
  }
  if (detectedPorts.length > 0) {
    return {
      id: "ports",
      label: labels.portSource,
      value: labels.systemDetected,
      detail: detectedPorts.map(formatPortEndpoint).join(", "),
      tone: "good"
    };
  }
  if (stalePorts.length > 0) {
    return {
      id: "ports",
      label: labels.portSource,
      value: labels.stalePorts,
      detail: stalePorts.map(formatPortEndpoint).join(", "),
      tone: "warn"
    };
  }
  return {
    id: "ports",
    label: labels.portSource,
    value: labels.none,
    detail: labels.noPortsDetail,
    tone: "normal"
  };
}

function failureDiagnostic(project: Project, locale: StatusReasonLocale): ProjectDiagnosticItem {
  const labels = diagnosticLabels(locale);
  if (projectHasAlreadyRunningConflict(project)) {
    return {
      id: "failure",
      label: labels.lastFailure,
      value: labels.portAlreadyRunning,
      detail: labels.portAlreadyRunningDetail,
      tone: "warn"
    };
  }
  if (project.lastError) {
    return {
      id: "failure",
      label: labels.lastFailure,
      value: labels.failed,
      detail: project.lastError.message,
      tone: "danger"
    };
  }
  return {
    id: "failure",
    label: labels.lastFailure,
    value: labels.none,
    detail: labels.noFailureDetail,
    tone: "good"
  };
}

function nextActionDiagnostic(project: Project, locale: StatusReasonLocale): ProjectDiagnosticItem {
  const labels = diagnosticLabels(locale);
  const openPorts = visibleProjectPorts(project);
  const stalePorts = staleProjectPorts(project);
  if (openPorts.length > 0) {
    return {
      id: "next",
      label: labels.nextAction,
      value: labels.openEndpoint,
      detail: labels.openEndpointDetail(openPorts.map(formatPortEndpoint).join(", ")),
      tone: "good"
    };
  }
  if (project.lastRun?.status === "running") {
    return {
      id: "next",
      label: labels.nextAction,
      value: labels.waitForEndpoint,
      detail: labels.watchLogsDetail,
      tone: "normal"
    };
  }
  if (stalePorts.length > 0) {
    return {
      id: "next",
      label: labels.nextAction,
      value: labels.cleanPorts,
      detail: labels.cleanPortsDetail,
      tone: "warn"
    };
  }
  if (projectHasFailed(project)) {
    return {
      id: "next",
      label: labels.nextAction,
      value: labels.reviewLogs,
      detail: labels.reviewLogsDetail,
      tone: "danger"
    };
  }
  const command = recommendedProjectCommand(project);
  if (command) {
    return {
      id: "next",
      label: labels.nextAction,
      value: labels.runCommand,
      detail: commandDisplay(command),
      tone: "normal"
    };
  }
  return {
    id: "next",
    label: labels.nextAction,
    value: labels.inspectEntry,
    detail: noCommandGuidance(project, locale),
    tone: "warn"
  };
}

function commandDisplay(command: Command): string {
  return `${command.command} ${command.args.join(" ")}`.trim();
}

function diagnosticLabels(locale: StatusReasonLocale) {
  if (locale === "en-US") {
    return {
      commandSource: "Command source",
      packageManager: "Package manager",
      portSource: "Port source",
      lastFailure: "Last failure",
      nextAction: "Next action",
      none: "None",
      unknown: "Unknown",
      failed: "Failed",
      packageScripts: "package.json scripts",
      detectedCommands: "detected entry",
      userCommands: "user command",
      recommendedCommand: (command: string) => `Recommended: ${command}`,
      commandCount: (count: number) => `${count} command(s) detected.`,
      notNodeProject: "Not a Node project",
      notNodeDetail: "This project does not need npm/pnpm/yarn detection.",
      packageUnknownDetail: "No package manager marker was found.",
      packageManagerDetail: "Inferred from packageManager or lockfile markers.",
      managedProcess: "Managed process",
      systemDetected: "System detected",
      stalePorts: "Needs cleanup",
      noPortsDetail: "No reachable local endpoint detected.",
      portAlreadyRunning: "Existing service",
      portAlreadyRunningDetail: "The last start failed because the service was already running; this is not treated as a project failure.",
      noFailureDetail: "No active failure recorded.",
      openEndpoint: "Open endpoint",
      openEndpointDetail: (endpoint: string) => `Use ${endpoint} directly, or stop it before restarting.`,
      waitForEndpoint: "Wait for endpoint",
      watchLogsDetail: "The command is running; keep the Logs tab open until the framework prints a local URL.",
      cleanPorts: "Clean port first",
      cleanPortsDetail: "Stop the stale port from the overview before starting this command again.",
      reviewLogs: "Review logs",
      reviewLogsDetail: "Open the Logs tab, fix the failing command, then run it again.",
      runCommand: "Run command",
      inspectEntry: "Inspect entry"
    };
  }

  return {
    commandSource: "命令来源",
    packageManager: "包管理器",
    portSource: "端口来源",
    lastFailure: "最近失败",
    nextAction: "下一步",
    none: "无",
    unknown: "未知",
    failed: "失败",
    packageScripts: "package.json scripts",
    detectedCommands: "入口探测",
    userCommands: "用户命令",
    recommendedCommand: (command: string) => `建议：${command}`,
    commandCount: (count: number) => `已识别 ${count} 个命令。`,
    notNodeProject: "非 Node 项目",
    notNodeDetail: "此项目不需要 npm/pnpm/yarn 判断。",
    packageUnknownDetail: "未发现包管理器标记。",
    packageManagerDetail: "由 packageManager 字段或 lockfile 推断。",
    managedProcess: "托管进程",
    systemDetected: "系统检测",
    stalePorts: "需清理",
    noPortsDetail: "未检测到可访问的本地地址。",
    portAlreadyRunning: "已有服务",
    portAlreadyRunningDetail: "上次启动失败是因为服务已经在运行，不按项目失败处理。",
    noFailureDetail: "没有记录中的有效失败。",
    openEndpoint: "打开地址",
    openEndpointDetail: (endpoint: string) => `直接使用 ${endpoint}；需要重启时先停止它。`,
    waitForEndpoint: "等待地址",
    watchLogsDetail: "命令正在运行，打开日志等待框架输出本地地址。",
    cleanPorts: "先清理端口",
    cleanPortsDetail: "在概况页停止残留端口后再重新运行命令。",
    reviewLogs: "查看日志",
    reviewLogsDetail: "打开日志页，修复失败原因后再运行。",
    runCommand: "运行命令",
    inspectEntry: "检查入口"
  };
}

export function formatPortEndpoint(port: Pick<PortStatus, "port" | "host">): string {
  return port.host ? `${port.host}:${port.port}` : String(port.port);
}

export function formatPortUrl(port: Pick<PortStatus, "port" | "host" | "url">): string {
  if (port.url) return port.url;
  const host = port.host ? formatUrlHost(port.host) : "localhost";
  return `http://${host}:${port.port}`;
}

export function countOpenPortsByNumber(projects: Project[]): Map<number, number> {
  const counts = new Map<number, number>();
  for (const project of projects) {
    const uniquePorts = new Set(visibleProjectPorts(project).map((port) => port.port));
    for (const port of uniquePorts) {
      counts.set(port, (counts.get(port) ?? 0) + 1);
    }
  }
  return counts;
}

export function hasPortConflict(project: Project, openPortCounts: Map<number, number>): boolean {
  return visibleProjectPorts(project).some((port) => (openPortCounts.get(port.port) ?? 0) > 1);
}

export function sortProjectsForDashboard(projects: Project[]): Project[] {
  return [...projects].sort((left, right) => {
    const onlineDelta = Number(projectIsOnline(right)) - Number(projectIsOnline(left));
    if (onlineDelta !== 0) return onlineDelta;

    const errorDelta = Number(projectHasFailed(right)) - Number(projectHasFailed(left));
    if (errorDelta !== 0) return errorDelta;

    const staleDelta = Number(projectHasStalePorts(right)) - Number(projectHasStalePorts(left));
    if (staleDelta !== 0) return staleDelta;

    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  });
}

export function projectMatchesQuery(project: Project, query: string): boolean {
  const normalizedQuery = normalize(query);
  if (!normalizedQuery) return true;

  const searchable = [
    project.name,
    project.path,
    project.kind,
    project.git.branch,
    project.packageManager ?? "",
    ...project.markers,
    ...project.commands.flatMap((command) => [command.label, command.kind, command.command, command.args.join(" ")]),
    ...project.ports.map(formatPortEndpoint)
  ]
    .map(normalize)
    .join(" ");

  return searchable.includes(normalizedQuery);
}

export function projectBelongsToRoot(project: Project, rootPath: string): boolean {
  const projectPath = normalizePath(project.path);
  const root = normalizePath(rootPath);
  return projectPath === root || projectPath.startsWith(`${root}/`);
}

export function formatDisplayPath(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("\\\\")) {
    return `\\\\${trimmed.slice(2).replace(/\\{2,}/g, "\\")}`;
  }
  return trimmed.replace(/\\{2,}/g, "\\");
}

function normalize(value: string): string {
  return value.trim().toLowerCase();
}

function normalizePath(value: string): string {
  return value.trim().replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function formatUrlHost(host: string): string {
  return host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
}

function commandDeclaredPorts(command: Command): number[] {
  const text = `${command.command} ${command.args.join(" ")}`;
  const ports = new Set<number>();
  for (const match of text.matchAll(/(?:--port(?:=|\s+)|-p\s+|PORT=|:)(\d{2,5})/gi)) {
    const port = Number(match[1]);
    if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port);
  }
  return [...ports];
}
