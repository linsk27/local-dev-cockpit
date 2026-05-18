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
    projectsEyebrow: "项目",
    projectsTitle: "恢复你的本地开发现场",
    refreshProjects: "刷新项目",
    loadingProjects: "正在扫描项目...",
    projectsHeading: "项目",
    dirty: "未提交",
    idle: "空闲",
    portConflict: "端口冲突",
    projectSearchPlaceholder: "搜索项目、路径、分支、端口...",
    projectSearchEmptyTitle: "没有匹配的项目",
    projectSearchEmptyDescription: "换一个项目名、路径、分支名或端口再试。",
    projectOnline: "在线",
    projectOffline: "空闲",
    projectFailed: "异常",
    openEndpoint: "打开运行地址",
    detectingEndpoint: "识别地址中",
    emptyTitle: "未发现项目",
    emptyDescription: "在设置里添加根目录，或运行 local-dev-cockpit add-root <dir>。",
    recoveryCard: "恢复卡片",
    stack: "技术栈",
    branch: "分支",
    ports: "端口",
    runningEndpoints: "运行地址",
    noRunningEndpoint: "未发现运行地址",
    detectedPorts: "检测端口",
    none: "无",
    commandRunning: "当前有命令正在运行，日志会在下方持续更新。",
    suggestedNextStep: "建议下一步：运行 {command}。",
    noCommandsSummary: "暂未识别到命令。可以添加根目录，或手动检查项目入口。",
    commands: "命令",
    runCommand: "运行命令",
    runNamedCommand: "运行 {command}",
    rerunNamedCommand: "重新运行 {command}",
    stopCommand: "停止命令",
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
    contextPlaceholder: "加载或复制当前项目上下文。",
    settingsEyebrow: "设置",
    settingsTitle: "工作台偏好",
    rootsTitle: "项目根目录",
    rootPath: "根目录路径",
    rootPlaceholder: "D:\\个人",
    addRoot: "添加根目录",
    rootSaved: "根目录已保存。回到项目页刷新即可看到结果。",
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
    projectsEyebrow: "Projects",
    projectsTitle: "Restore your local development state",
    refreshProjects: "Refresh projects",
    loadingProjects: "Scanning projects...",
    projectsHeading: "Projects",
    dirty: "dirty",
    idle: "idle",
    portConflict: "Port conflict",
    projectSearchPlaceholder: "Search projects, paths, branches, ports...",
    projectSearchEmptyTitle: "No matching projects",
    projectSearchEmptyDescription: "Try another project name, path, branch, or port.",
    projectOnline: "Online",
    projectOffline: "Idle",
    projectFailed: "Failed",
    openEndpoint: "Open endpoint",
    detectingEndpoint: "Detecting endpoint",
    emptyTitle: "No projects found",
    emptyDescription: "Add a root directory in Settings or run local-dev-cockpit add-root <dir>.",
    recoveryCard: "Recovery card",
    stack: "Stack",
    branch: "Branch",
    ports: "Ports",
    runningEndpoints: "Running endpoints",
    noRunningEndpoint: "No running endpoint",
    detectedPorts: "Detected ports",
    none: "none",
    commandRunning: "A command is currently running. Logs are streaming below.",
    suggestedNextStep: "Suggested next step: run {command}.",
    noCommandsSummary: "No commands detected yet. Add a root or inspect the project manually.",
    commands: "Commands",
    runCommand: "Run command",
    runNamedCommand: "Run {command}",
    rerunNamedCommand: "Run {command} again",
    stopCommand: "Stop command",
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
    contextPlaceholder: "Load or copy context for this project.",
    settingsEyebrow: "Settings",
    settingsTitle: "Workspace preferences",
    rootsTitle: "Project roots",
    rootPath: "Root path",
    rootPlaceholder: "D:\\personal",
    addRoot: "Add root",
    rootSaved: "Root saved. Return to Projects and refresh.",
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
