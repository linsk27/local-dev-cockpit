import { computed, ref } from "vue";
import { defineStore } from "pinia";

const STORAGE_KEY = "dev-cockpit:preferences";

export type Locale = "zh-CN" | "en-US";
export type ThemeMode = "system" | "dark" | "light";
export type AccentColor = "violet" | "cyan" | "emerald" | "amber" | "rose";

export interface PreferenceOption<T extends string> {
  value: T;
  labelKey: MessageKey;
}

interface PersistedPreferences {
  locale?: Locale;
  themeMode?: ThemeMode;
  accentColor?: AccentColor;
}

export const messages = {
  "zh-CN": {
    appSubtitle: "本地工作台",
    navProjects: "项目",
    navSettings: "设置",
    localOnly: "仅本地运行",
    noCloudSync: "无云端同步",
    collapseSidebar: "收起侧栏",
    expandSidebar: "展开侧栏",
    resourceMonitor: "资源占用",
    resourceWaiting: "等待扫描",
    resourceLow: "占用低",
    resourceMedium: "占用中",
    resourceHigh: "占用高",
    performanceMemory: "内存 {memory}MB",
    performanceScan: "扫描 {duration}",
    performanceCpu: "CPU {cpu}%",
    performanceTooltip: "显示 Dev Cockpit 自身开销，不是项目服务占用。",
    performanceCache: "缓存命中/重扫 {hits}/{misses}",
    projectsEyebrow: "总览",
    projectsTitle: "本地开发控制台",
    onboardingEyebrow: "首次使用",
    onboardingTitle: "从一个工作区开始",
    onboardingDescription: "选择一个包含项目的文件夹，Dev Cockpit 会扫描启动命令、Git 状态、端口、日志和 AI 上下文入口。",
    onboardingStepScan: "扫描项目",
    onboardingStepScanDetail: "识别 Node、Python、Go、Rust、Docker 和混合项目。",
    onboardingStepRun: "恢复运行",
    onboardingStepRunDetail: "查看命令、端口、上次错误，并从面板启动或停止。",
    onboardingStepContext: "交给 AI",
    onboardingStepContextDetail: "复制当前项目状态，给 Codex、Cursor 或 Claude 接着干活。",
    onboardingAddRoot: "添加并扫描",
    onboardingPrivacy: "只读取本机项目元数据；默认不上传代码，也不会写入项目目录。",
    refreshProjects: "刷新项目",
    loadingProjects: "正在扫描项目...",
    projectsHeading: "项目",
    dirty: "未提交",
    idle: "空闲",
    portConflict: "端口冲突",
    projectSearchPlaceholder: "搜索项目、路径、分支、端口...",
    rootFilterLabel: "按根目录筛选",
    selectRootOption: "选择根目录",
    projectSearchEmptyTitle: "没有匹配的项目",
    projectSearchEmptyDescription: "换一个项目名、路径、分支名或端口再试。",
    projectOnline: "在线",
    projectRunning: "运行中",
    projectManagedRunning: "托管运行",
    projectDetectedOnline: "外部在线",
    projectNeedsCleanup: "需清理",
    projectOffline: "空闲",
    projectFailed: "异常",
    openEndpoint: "打开运行地址",
    detectingEndpoint: "识别地址中",
    emptyTitle: "未发现项目",
    emptyDescription: "当前根目录没有识别到项目。可以换一个更具体的工作区，或确认目录里有 package.json、pyproject.toml、go.mod 等入口文件。",
    addAnotherRoot: "添加工作区",
    recoveryCard: "恢复卡片",
    quickActions: "快捷操作",
    copyPath: "复制路径",
    copyAiContext: "复制上下文",
    pathCopiedNotice: "项目路径已复制。",
    openFolder: "打开文件夹",
    openFolderNotice: "已打开项目文件夹。",
    openFolderFailedNotice: "打开文件夹失败：{message}",
    openEditor: "编辑器",
    openEditorNotice: "已用编辑器打开项目。",
    openEditorFailedNotice: "打开编辑器失败：{message}",
    stack: "技术栈",
    branch: "分支",
    runtimeSource: "运行来源",
    ports: "端口",
    runningEndpoints: "运行地址",
    statusReason: "状态依据",
    noRunningEndpoint: "未发现运行地址",
    detectedPorts: "检测端口",
    stalePorts: "残留端口",
    none: "无",
    commandRunning: "当前有命令正在运行，日志会在下方持续更新。",
    noCommandsSummary: "暂未识别到命令。可以添加根目录，或手动检查项目入口。",
    projectOverview: "概况",
    diagnostics: "诊断",
    commands: "命令",
    runCommand: "运行命令",
    stopCommand: "停止命令",
    commandStartedNotice: "已开始运行 {command}，日志会自动更新。",
    commandStoppedNotice: "已停止 {command}。",
    commandActionFailedNotice: "命令操作失败：{message}",
    starting: "启动中",
    stopping: "停止中",
    running: "运行中",
    noCommands: "未识别到命令。",
    logs: "日志",
    reload: "重新加载",
    viewLogs: "查看上次日志",
    emptyRunLogs: "本次运行暂无日志。",
    previousRunLogsPrompt: "此项目有上次运行日志，点击查看上次日志后再显示。",
    runCommandPrompt: "运行一个命令后开始收集日志。",
    aiContext: "AI 上下文",
    copy: "复制",
    contextCopiedNotice: "AI 上下文已复制。",
    contextCopyFailedNotice: "复制失败：{message}",
    contextWrite: "写入文件",
    contextWrittenNotice: "已写入 {count} 个上下文文件。",
    contextWriteFailedNotice: "写入失败：{message}",
    contextPlaceholder: "加载或复制当前项目上下文。",
    contextPanelDescription: "给 Codex、Cursor 或 Claude 的项目状态摘要。",
    contextPreview: "预览",
    contextRefresh: "刷新预览",
    contextCompactPlaceholder: "需要时再预览或复制，不默认展开大段文本。",
    projectsRefreshedNotice: "已刷新，发现 {count} 个项目。",
    refreshFailedNotice: "刷新失败：{message}",
    settingsEyebrow: "设置",
    settingsTitle: "工作台偏好",
    rootsTitle: "项目根目录",
    configuredRootsTitle: "已配置根目录",
    noRootsConfigured: "暂未配置根目录。",
    rootPath: "根目录路径",
    rootPlaceholder: "D:\\个人",
    addRoot: "添加根目录",
    removeRoot: "移除根目录",
    rootSaved: "根目录已保存。回到项目页刷新即可看到结果。",
    rootAddedNotice: "已添加根目录。",
    rootRemovedNotice: "已移除根目录。",
    rootActionFailedNotice: "根目录操作失败：{message}",
    editorTitle: "编辑器",
    editorCommand: "编辑器命令",
    editorCommandPlaceholder: "code 或 cursor",
    saveEditorCommand: "保存编辑器",
    editorSavedNotice: "编辑器命令已保存。",
    appearanceTitle: "外观",
    languageTitle: "语言",
    themeTitle: "主题",
    accentTitle: "强调色",
    themeSystem: "跟随系统",
    themeDark: "深色",
    themeLight: "浅色",
    localeZh: "中文",
    localeEn: "English",
    accentViolet: "紫色",
    accentCyan: "青色",
    accentEmerald: "绿色",
    accentAmber: "琥珀色",
    accentRose: "玫瑰色"
  },
  "en-US": {
    appSubtitle: "Local workspace",
    navProjects: "Projects",
    navSettings: "Settings",
    localOnly: "Local only",
    noCloudSync: "No cloud sync",
    collapseSidebar: "Collapse sidebar",
    expandSidebar: "Expand sidebar",
    resourceMonitor: "Resource use",
    resourceWaiting: "Waiting for scan",
    resourceLow: "Low use",
    resourceMedium: "Medium use",
    resourceHigh: "High use",
    performanceMemory: "Memory {memory}MB",
    performanceScan: "Scan {duration}",
    performanceCpu: "CPU {cpu}%",
    performanceTooltip: "Shows Dev Cockpit's own overhead, not project service usage.",
    performanceCache: "Cache hit/rescan {hits}/{misses}",
    projectsEyebrow: "Overview",
    projectsTitle: "Local development cockpit",
    onboardingEyebrow: "First run",
    onboardingTitle: "Start with one workspace",
    onboardingDescription: "Choose a folder that contains your projects. Dev Cockpit scans commands, Git state, ports, logs, and AI context entry points.",
    onboardingStepScan: "Scan projects",
    onboardingStepScanDetail: "Detect Node, Python, Go, Rust, Docker, and mixed projects.",
    onboardingStepRun: "Resume work",
    onboardingStepRunDetail: "See commands, ports, last errors, and start or stop services from the panel.",
    onboardingStepContext: "Hand off to AI",
    onboardingStepContextDetail: "Copy project state for Codex, Cursor, or Claude.",
    onboardingAddRoot: "Add and scan",
    onboardingPrivacy: "Reads local project metadata only; no code upload and no project writes by default.",
    refreshProjects: "Refresh projects",
    loadingProjects: "Scanning projects...",
    projectsHeading: "Projects",
    dirty: "dirty",
    idle: "idle",
    portConflict: "Port conflict",
    projectSearchPlaceholder: "Search projects, paths, branches, ports...",
    rootFilterLabel: "Filter by root",
    selectRootOption: "Select root",
    projectSearchEmptyTitle: "No matching projects",
    projectSearchEmptyDescription: "Try another project name, path, branch, or port.",
    projectOnline: "Online",
    projectRunning: "Running",
    projectManagedRunning: "Managed",
    projectDetectedOnline: "External",
    projectNeedsCleanup: "Cleanup",
    projectOffline: "Idle",
    projectFailed: "Failed",
    openEndpoint: "Open endpoint",
    detectingEndpoint: "Detecting endpoint",
    emptyTitle: "No projects found",
    emptyDescription: "No projects were detected in the current root. Choose a more specific workspace or check for package.json, pyproject.toml, go.mod, or similar entry files.",
    addAnotherRoot: "Add workspace",
    recoveryCard: "Recovery card",
    quickActions: "Quick actions",
    copyPath: "Copy path",
    copyAiContext: "Copy context",
    pathCopiedNotice: "Project path copied.",
    openFolder: "Open folder",
    openFolderNotice: "Project folder opened.",
    openFolderFailedNotice: "Open folder failed: {message}",
    openEditor: "Editor",
    openEditorNotice: "Project opened in editor.",
    openEditorFailedNotice: "Open editor failed: {message}",
    stack: "Stack",
    branch: "Branch",
    runtimeSource: "Source",
    ports: "Ports",
    runningEndpoints: "Running endpoints",
    statusReason: "Status source",
    noRunningEndpoint: "No running endpoint",
    detectedPorts: "Detected ports",
    stalePorts: "Stale ports",
    none: "none",
    commandRunning: "A command is currently running. Logs are streaming below.",
    noCommandsSummary: "No commands detected yet. Add a root or inspect the project manually.",
    projectOverview: "Overview",
    diagnostics: "Diagnostics",
    commands: "Commands",
    runCommand: "Run command",
    stopCommand: "Stop command",
    commandStartedNotice: "Started {command}. Logs will update automatically.",
    commandStoppedNotice: "Stopped {command}.",
    commandActionFailedNotice: "Command action failed: {message}",
    starting: "Starting",
    stopping: "Stopping",
    running: "Running",
    noCommands: "No commands detected.",
    logs: "Logs",
    reload: "Reload",
    viewLogs: "View last logs",
    emptyRunLogs: "Logs are empty for this run.",
    previousRunLogsPrompt: "This project has logs from the last run. Click View last logs to show them.",
    runCommandPrompt: "Run a command to start collecting logs.",
    aiContext: "AI Context",
    copy: "Copy",
    contextCopiedNotice: "AI context copied.",
    contextCopyFailedNotice: "Copy failed: {message}",
    contextWrite: "Write files",
    contextWrittenNotice: "Wrote {count} context file(s).",
    contextWriteFailedNotice: "Write failed: {message}",
    contextPlaceholder: "Load or copy context for this project.",
    contextPanelDescription: "Project state summary for Codex, Cursor, or Claude.",
    contextPreview: "Preview",
    contextRefresh: "Refresh preview",
    contextCompactPlaceholder: "Preview or copy only when needed; long text stays collapsed by default.",
    projectsRefreshedNotice: "Refreshed. Found {count} projects.",
    refreshFailedNotice: "Refresh failed: {message}",
    settingsEyebrow: "Settings",
    settingsTitle: "Workspace preferences",
    rootsTitle: "Project roots",
    configuredRootsTitle: "Configured roots",
    noRootsConfigured: "No roots configured yet.",
    rootPath: "Root path",
    rootPlaceholder: "D:\\personal",
    addRoot: "Add root",
    removeRoot: "Remove root",
    rootSaved: "Root saved. Return to Projects and refresh.",
    rootAddedNotice: "Root added.",
    rootRemovedNotice: "Root removed.",
    rootActionFailedNotice: "Root action failed: {message}",
    editorTitle: "Editor",
    editorCommand: "Editor command",
    editorCommandPlaceholder: "code or cursor",
    saveEditorCommand: "Save editor",
    editorSavedNotice: "Editor command saved.",
    appearanceTitle: "Appearance",
    languageTitle: "Language",
    themeTitle: "Theme",
    accentTitle: "Accent color",
    themeSystem: "System",
    themeDark: "Dark",
    themeLight: "Light",
    localeZh: "中文",
    localeEn: "English",
    accentViolet: "Violet",
    accentCyan: "Cyan",
    accentEmerald: "Emerald",
    accentAmber: "Amber",
    accentRose: "Rose"
  }
} as const;

export type MessageKey = keyof (typeof messages)["en-US"];

export const localeOptions: PreferenceOption<Locale>[] = [
  { value: "zh-CN", labelKey: "localeZh" },
  { value: "en-US", labelKey: "localeEn" }
];

export const themeOptions: PreferenceOption<ThemeMode>[] = [
  { value: "system", labelKey: "themeSystem" },
  { value: "dark", labelKey: "themeDark" },
  { value: "light", labelKey: "themeLight" }
];

export const accentOptions: PreferenceOption<AccentColor>[] = [
  { value: "violet", labelKey: "accentViolet" },
  { value: "cyan", labelKey: "accentCyan" },
  { value: "emerald", labelKey: "accentEmerald" },
  { value: "amber", labelKey: "accentAmber" },
  { value: "rose", labelKey: "accentRose" }
];

/**
 * Owns user-facing presentation preferences. Keeping this in the web layer
 * avoids expanding server configuration before the product needs syncable UI
 * preferences.
 */
export const usePreferencesStore = defineStore("preferences", () => {
  const locale = ref<Locale>("zh-CN");
  const themeMode = ref<ThemeMode>("dark");
  const accentColor = ref<AccentColor>("violet");
  const resolvedTheme = computed<"dark" | "light">(() => {
    if (themeMode.value !== "system") return themeMode.value;
    return prefersLightTheme() ? "light" : "dark";
  });

  function init(): void {
    const saved = readPreferences();
    locale.value = saved.locale ?? "zh-CN";
    themeMode.value = saved.themeMode ?? "dark";
    accentColor.value = saved.accentColor ?? "violet";
    applyPreferences();

    window.matchMedia?.("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (themeMode.value === "system") applyPreferences();
    });
  }

  function t(key: MessageKey, values: Record<string, string | number> = {}): string {
    let text: string = messages[locale.value][key] ?? messages["en-US"][key] ?? key;
    for (const [name, value] of Object.entries(values)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  }

  function setLocale(nextLocale: Locale): void {
    locale.value = nextLocale;
    applyPreferences();
  }

  function setThemeMode(nextTheme: ThemeMode): void {
    themeMode.value = nextTheme;
    applyPreferences();
  }

  function setAccentColor(nextAccent: AccentColor): void {
    accentColor.value = nextAccent;
    applyPreferences();
  }

  function applyPreferences(): void {
    document.documentElement.dataset.theme = resolvedTheme.value;
    document.documentElement.dataset.themeMode = themeMode.value;
    document.documentElement.dataset.accent = accentColor.value;
    document.documentElement.lang = locale.value;
    writePreferences({ locale: locale.value, themeMode: themeMode.value, accentColor: accentColor.value });
  }

  return {
    locale,
    themeMode,
    accentColor,
    resolvedTheme,
    init,
    t,
    setLocale,
    setThemeMode,
    setAccentColor
  };
});

function readPreferences(): PersistedPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as PersistedPreferences) : {};
  } catch {
    return {};
  }
}

function writePreferences(preferences: Required<PersistedPreferences>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
}

function prefersLightTheme(): boolean {
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ?? false;
}
