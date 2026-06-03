import type { Command, Project } from "@local-dev-cockpit/core";
import { formatPortEndpoint, projectHasStalePorts, staleProjectPorts, visibleProjectPorts } from "./project-view-ports";

export type StatusReasonLocale = "zh-CN" | "en-US";
export type ProjectRuntimeMode = "managed-running" | "detected-online" | "stale" | "failed" | "idle";

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

export function projectFailureActionHint(project: Project, locale: StatusReasonLocale = "zh-CN"): string {
  const message = project.lastError?.message ?? "";
  if (!message) return "";
  const isEnglish = locale === "en-US";

  if (projectHasAlreadyRunningConflict(project) || /端口已被占用|已有 Next\.js dev server|EADDRINUSE|winerror 10048|通常每个套接字/i.test(message)) {
    return isEnglish
      ? "Use the existing endpoint, or stop the occupied port before starting again."
      : "先打开已有运行地址；如需重启，先停止或清理占用端口。";
  }

  if (/缺少 Python 依赖|ModuleNotFoundError|python -m pip install|conda run -n/i.test(message)) {
    return isEnglish
      ? "Install the missing package in the same Python environment, or bind the correct environment in diagnostics."
      : "按提示在同一个 Python 环境安装缺失依赖，或在诊断里绑定正确环境。";
  }

  if (/未找到可用的 Python|找不到 conda|Conda 环境|Python 环境|conda:环境名/i.test(message)) {
    return isEnglish
      ? "Bind the Python/Conda environment used by your terminal or editor, then run again."
      : "绑定终端或编辑器实际使用的 Python/Conda 环境，再重新运行。";
  }

  if (/缺少 Node 依赖|脚本命令缺失|node_modules|Cannot find package|Cannot find module/i.test(message)) {
    return isEnglish
      ? "Install project dependencies in this working directory, then run the command again."
      : "先在当前项目目录安装依赖，再重新运行命令。";
  }

  if (/not recognized as an internal or external command|command not found|spawn .+ ENOENT/i.test(message)) {
    return isEnglish
      ? "Install or expose this command on PATH, then run it again."
      : "先安装该命令，或确认它已在 PATH 中可用，再重新运行。";
  }

  return "";
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
