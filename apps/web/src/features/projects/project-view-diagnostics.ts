import type { Command, Project } from "@local-dev-cockpit/core";
import { detectedProjectPorts, formatPortEndpoint, runningProjectPorts, staleProjectPorts, visibleProjectPorts } from "./project-view-ports";
import { noCommandGuidance, projectHasAlreadyRunningConflict, projectHasFailed, recommendedProjectCommand, type StatusReasonLocale } from "./project-view-status";

export interface ProjectDiagnosticItem {
  id: "environment" | "ports" | "failure" | "next";
  label: string;
  value: string;
  detail: string;
  tone: "normal" | "good" | "warn" | "danger";
}

export function projectDiagnostics(project: Project, locale: StatusReasonLocale = "zh-CN"): ProjectDiagnosticItem[] {
  return [
    environmentDiagnostic(project, locale),
    portSourceDiagnostic(project, locale),
    failureDiagnostic(project, locale),
    nextActionDiagnostic(project, locale)
  ];
}

function environmentDiagnostic(project: Project, locale: StatusReasonLocale): ProjectDiagnosticItem {
  const labels = diagnosticLabels(locale);
  if (project.commands.length === 0) {
    return {
      id: "environment",
      label: labels.environment,
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
  const packageText = project.kind === "node" ? project.packageManager ?? labels.unknownPackageManager : project.kind;
  return {
    id: "environment",
    label: labels.environment,
    value: packageText,
    detail: recommended
      ? labels.environmentDetail(sources.join(" + "), commandDisplay(recommended))
      : labels.commandCount(project.commands.length),
    tone: project.kind === "node" && !project.packageManager ? "warn" : "good"
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
      value: projectFailureHeadline(project, locale),
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

export function projectFailureHeadline(project: Project, locale: StatusReasonLocale = "zh-CN"): string {
  const message = project.lastError?.message ?? "";
  const isEnglish = locale === "en-US";
  if (!message) return isEnglish ? "No failure" : "无失败";

  if (projectHasAlreadyRunningConflict(project) || /端口已被占用|已有 Next\.js dev server|EADDRINUSE|winerror 10048|通常每个套接字|port \d+ is in use/i.test(message)) {
    return isEnglish ? "Port occupied" : "端口占用";
  }

  const pythonModule =
    message.match(/缺少 Python 依赖[:：]\s*([^。\s]+)/i)?.[1]?.trim() ??
    message.match(/ModuleNotFoundError:\s*No module named ['"]([^'"]+)['"]/i)?.[1]?.trim();
  if (pythonModule) return isEnglish ? `Missing Python package: ${pythonModule}` : `缺少 Python 依赖：${pythonModule}`;

  if (/未找到可用的 Python|找不到 conda|Conda 环境|Python 环境|conda:环境名/i.test(message)) {
    return isEnglish ? "Python environment mismatch" : "Python 环境不一致";
  }

  if (/缺少 Node 依赖|脚本命令缺失|node_modules|Cannot find package|Cannot find module/i.test(message)) {
    return isEnglish ? "Node dependencies missing" : "Node 依赖缺失";
  }

  if (/not recognized as an internal or external command|command not found|spawn .+ ENOENT/i.test(message)) {
    return isEnglish ? "Command not found" : "命令不可用";
  }

  const firstSentence = message.split(/[。\r\n]/).map((item) => item.trim()).find(Boolean);
  if (!firstSentence) return isEnglish ? "Command failed" : "命令失败";
  return firstSentence.length > 42 ? `${firstSentence.slice(0, 42)}...` : firstSentence;
}

function diagnosticLabels(locale: StatusReasonLocale) {
  if (locale === "en-US") {
    return {
      environment: "Environment",
      portSource: "Port source",
      lastFailure: "Last failure",
      nextAction: "Next action",
      none: "None",
      unknown: "Unknown",
      unknownPackageManager: "Node package manager unknown",
      packageScripts: "package.json scripts",
      detectedCommands: "detected entry",
      userCommands: "user command",
      environmentDetail: (source: string, command: string) => `${source}; next command: ${command}`,
      commandCount: (count: number) => `${count} command(s) detected.`,
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
    environment: "环境",
    portSource: "端口来源",
    lastFailure: "最近失败",
    nextAction: "下一步",
    none: "无",
    unknown: "未知",
    unknownPackageManager: "Node 包管理器未知",
    packageScripts: "package.json scripts",
    detectedCommands: "入口探测",
    userCommands: "用户命令",
    environmentDetail: (source: string, command: string) => `${source}；建议运行 ${command}`,
    commandCount: (count: number) => `已识别 ${count} 个命令。`,
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
