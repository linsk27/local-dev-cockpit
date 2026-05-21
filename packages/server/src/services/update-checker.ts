const GITHUB_REPOSITORY = "linsk27/local-dev-cockpit";
const GITHUB_RELEASES_URL = `https://github.com/${GITHUB_REPOSITORY}/releases`;
const LATEST_RELEASE_URL = `https://api.github.com/repos/${GITHUB_REPOSITORY}/releases/latest`;
const NPM_LATEST_URL = "https://registry.npmjs.org/local-dev-cockpit/latest";

export interface ReleaseAssetSummary {
  name: string;
  size: number;
  downloadUrl: string;
}

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion?: string;
  hasUpdate: boolean;
  source?: "github" | "npm";
  releaseUrl?: string;
  installerAsset?: ReleaseAssetSummary;
  portableAsset?: ReleaseAssetSummary;
  checkedAt: string;
  warning?: string;
  error?: string;
}

/**
 * Checks for desktop/CLI updates with a GitHub-first strategy and npm fallback.
 * Keeping this service isolated prevents release-network behavior from leaking
 * into project scanning or process-management code.
 */
export async function checkForUpdates(currentVersion: string): Promise<UpdateCheckResult> {
  const checkedAt = new Date().toISOString();
  let githubError: unknown;

  try {
    const release = await fetchLatestGithubRelease(currentVersion);
    const assets = selectUpdateAssets(release.assets);
    return {
      currentVersion,
      latestVersion: release.version,
      hasUpdate: isNewerVersion(release.version, currentVersion),
      source: "github",
      releaseUrl: release.htmlUrl,
      installerAsset: assets.installerAsset,
      portableAsset: assets.portableAsset,
      checkedAt
    };
  } catch (error) {
    githubError = error;
  }

  try {
    const release = buildNpmFallbackRelease(await fetchLatestNpmVersion(currentVersion));
    const assets = selectUpdateAssets(release.assets);
    return {
      currentVersion,
      latestVersion: release.version,
      hasUpdate: isNewerVersion(release.version, currentVersion),
      source: "npm",
      releaseUrl: release.htmlUrl,
      installerAsset: assets.installerAsset,
      portableAsset: assets.portableAsset,
      checkedAt,
      warning: formatNpmFallbackWarning(githubError)
    };
  } catch (npmError) {
    return {
      currentVersion,
      hasUpdate: false,
      checkedAt,
      releaseUrl: `${GITHUB_RELEASES_URL}/latest`,
      error: formatCombinedUpdateCheckError(githubError, npmError)
    };
  }
}

async function fetchLatestGithubRelease(currentVersion: string): Promise<{ version: string; htmlUrl: string; assets: ReleaseAssetSummary[] }> {
  const response = await fetchJsonWithTimeout(LATEST_RELEASE_URL, {
    timeoutMs: 8_000,
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": `Dev-Cockpit/${currentVersion}`
    },
    label: "GitHub releases"
  });
  return parseGithubRelease(response);
}

async function fetchLatestNpmVersion(currentVersion: string): Promise<string> {
  const response = await fetchJsonWithTimeout(NPM_LATEST_URL, {
    timeoutMs: 8_000,
    headers: {
      accept: "application/json",
      "user-agent": `Dev-Cockpit/${currentVersion}`
    },
    label: "npm registry"
  });
  return parseNpmLatest(response).version;
}

async function fetchJsonWithTimeout(
  url: string,
  options: { timeoutMs: number; headers: Record<string, string>; label: string }
): Promise<unknown> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs);
  try {
    const response = await fetch(url, {
      headers: options.headers,
      signal: controller.signal
    });
    if (!response.ok) {
      throw new Error(`${options.label} request failed: ${response.status}`);
    }
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function buildNpmFallbackRelease(version: string): { version: string; htmlUrl: string; assets: ReleaseAssetSummary[] } {
  const releaseUrl = `${GITHUB_RELEASES_URL}/tag/v${version}`;
  const assetNames = [`Dev-Cockpit-Setup-${version}-win-x64.exe`, `Dev-Cockpit-${version}-win-x64.exe`];
  return {
    version,
    htmlUrl: releaseUrl,
    assets: assetNames.map((name) => ({
      name,
      size: 0,
      downloadUrl: `${GITHUB_RELEASES_URL}/download/v${version}/${name}`
    }))
  };
}

export function parseNpmLatest(raw: unknown): { version: string } {
  if (!raw || typeof raw !== "object") throw new Error("Invalid npm latest response");
  const packageInfo = raw as { version?: unknown };
  const version = typeof packageInfo.version === "string" ? packageInfo.version.trim().replace(/^v/i, "") : "";
  if (!version) throw new Error("npm latest response is missing version");
  return { version };
}

function formatNpmFallbackWarning(error: unknown): string {
  const message = formatUpdateCheckError(error);
  return `${message} 已改用 npm registry 获取最新版本；如果下载按钮仍打不开，请手动访问 GitHub Releases。`;
}

function formatCombinedUpdateCheckError(githubError: unknown, npmError: unknown): string {
  return [
    "无法连接 GitHub Releases，也无法连接 npm registry。",
    "请检查网络、代理或证书设置；如果浏览器能打开 GitHub，可以手动访问发布页下载。",
    `GitHub：${formatUpdateCheckError(githubError)}`,
    `npm：${formatRegistryCheckError(npmError)}`
  ].join(" ");
}

export function formatUpdateCheckError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "AbortError") {
    return "连接 GitHub Releases 超时。请检查网络或代理，或手动打开 GitHub Release 页面下载。";
  }
  if (/fetch failed|network|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|certificate|self signed/i.test(message)) {
    return "无法连接 GitHub Releases。请检查网络、代理或证书设置；也可以手动打开 GitHub Release 页面下载。";
  }
  const status = message.match(/GitHub releases request failed:\s*(\d+)/i)?.[1];
  if (status === "403") {
    return "GitHub API 暂时限流或拒绝访问。请稍后重试，或手动打开 GitHub Release 页面下载。";
  }
  if (status === "404") {
    return "没有找到可用的 GitHub Release。请稍后重试或检查项目发布页。";
  }
  if (status) {
    return `GitHub Releases 返回 ${status}。请稍后重试，或手动打开 GitHub Release 页面下载。`;
  }
  return message || "检查更新失败。请稍后重试，或手动打开 GitHub Release 页面下载。";
}

function formatRegistryCheckError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.name === "AbortError") return "连接 npm registry 超时。";
  if (/fetch failed|network|ENOTFOUND|ECONNRESET|ECONNREFUSED|ETIMEDOUT|certificate|self signed/i.test(message)) {
    return "无法连接 npm registry。";
  }
  const status = message.match(/npm registry request failed:\s*(\d+)/i)?.[1];
  if (status) return `npm registry 返回 ${status}。`;
  return message || "npm registry 检查失败。";
}

export function isNewerVersion(candidate: string, current: string): boolean {
  const left = normalizeVersion(candidate);
  const right = normalizeVersion(current);
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    const delta = (left[index] ?? 0) - (right[index] ?? 0);
    if (delta > 0) return true;
    if (delta < 0) return false;
  }
  return false;
}

export function selectUpdateAssets(assets: ReleaseAssetSummary[]): {
  installerAsset?: ReleaseAssetSummary;
  portableAsset?: ReleaseAssetSummary;
} {
  const exeAssets = assets.filter((asset) => /\.exe$/i.test(asset.name));
  return {
    installerAsset:
      exeAssets.find((asset) => /setup/i.test(asset.name) && /win/i.test(asset.name)) ??
      exeAssets.find((asset) => /installer/i.test(asset.name)),
    portableAsset:
      exeAssets.find((asset) => !/setup|installer/i.test(asset.name) && /win/i.test(asset.name)) ??
      exeAssets.find((asset) => !/setup|installer/i.test(asset.name))
  };
}

function normalizeVersion(version: string): number[] {
  return version
    .trim()
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function parseGithubRelease(raw: unknown): { version: string; htmlUrl: string; assets: ReleaseAssetSummary[] } {
  if (!raw || typeof raw !== "object") throw new Error("Invalid GitHub release response");
  const release = raw as {
    tag_name?: unknown;
    html_url?: unknown;
    assets?: Array<{ name?: unknown; size?: unknown; browser_download_url?: unknown }>;
  };
  const version = typeof release.tag_name === "string" ? release.tag_name.replace(/^v/i, "") : "";
  const htmlUrl = typeof release.html_url === "string" ? release.html_url : "";
  if (!version || !htmlUrl) throw new Error("GitHub release response is missing tag or URL");
  return {
    version,
    htmlUrl,
    assets: (release.assets ?? [])
      .filter((asset) => typeof asset.name === "string" && typeof asset.browser_download_url === "string")
      .map((asset) => ({
        name: asset.name as string,
        size: typeof asset.size === "number" ? asset.size : 0,
        downloadUrl: asset.browser_download_url as string
      }))
  };
}
