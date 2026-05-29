import type { ResourceMetadata } from "./types.js";

const FETCH_TIMEOUT_MS = 6_000;
const MAX_METADATA_BYTES = 256 * 1024;
const MAX_GITHUB_JSON_BYTES = 80 * 1024;

type ResourceImage = NonNullable<ResourceMetadata["images"]>[number];

export interface FetchResourceMetadataResult {
  metadata?: ResourceMetadata;
  error?: string;
}

export async function fetchResourceMetadata(sourceUrl: string): Promise<FetchResourceMetadataResult> {
  const parsed = parseHttpUrl(sourceUrl);
  if (!parsed) return {};

  try {
    if (parsed.hostname.toLowerCase() === "github.com") {
      const githubMetadata = await fetchGitHubReadme(parsed);
      if (githubMetadata.metadata) return githubMetadata;
    }
    return await fetchPageMetadata(parsed);
  } catch (error) {
    return { error: readableError(error) };
  }
}

async function fetchGitHubReadme(url: URL): Promise<FetchResourceMetadataResult> {
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 2) return {};
  const [owner, repoWithSuffix] = parts;
  const repo = repoWithSuffix?.replace(/\.git$/i, "");
  if (!owner || !repo) return {};

  const repoMetadata = await fetchGitHubRepository(owner, repo);
  for (const branch of ["HEAD", "main", "master"]) {
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/README.md`;
    const response = await fetchLimitedText(rawUrl, ["text/plain", "text/markdown", "application/octet-stream"]);
    if (!response.text) continue;
    const readme = stripMarkdownNoise(response.text);
    const repository = repoMetadata.repository;
    const githubImage = githubOpenGraphImage(owner, repo);
    const images = compactImages([
      { label: "GitHub preview", url: githubImage, source: "github-open-graph" },
      ...extractMarkdownImages(response.text, rawUrl)
    ]);
    return {
      metadata: {
        title: repository?.name ?? repo,
        description: repository?.description ?? firstUsefulParagraph(readme),
        siteName: "GitHub",
        fetchedUrl: rawUrl,
        imageUrl: images?.[0]?.url ?? githubImage,
        images,
        textSample: trimText(normalizeWhitespace(readme), 4_000),
        links: compactLinks([
          { label: "GitHub", url: `https://github.com/${owner}/${repo}` },
          repository?.homepage ? { label: "Homepage", url: repository.homepage } : undefined,
          { label: "README", url: rawUrl }
        ]),
        repository
      }
    };
  }
  if (repoMetadata.repository) {
    const repository = repoMetadata.repository;
    const githubImage = githubOpenGraphImage(owner, repo);
    const images = compactImages([{ label: "GitHub preview", url: githubImage, source: "github-open-graph" }]);
    return {
      metadata: {
        title: repository.name ?? repo,
        description: repository.description,
        siteName: "GitHub",
        fetchedUrl: `https://github.com/${owner}/${repo}`,
        imageUrl: images?.[0]?.url ?? githubImage,
        images,
        textSample: repository.description,
        links: compactLinks([
          { label: "GitHub", url: `https://github.com/${owner}/${repo}` },
          repository.homepage ? { label: "Homepage", url: repository.homepage } : undefined
        ]),
        repository
      }
    };
  }
  return {};
}

async function fetchGitHubRepository(owner: string, repo: string): Promise<{ repository?: NonNullable<ResourceMetadata["repository"]> }> {
  const response = await fetchLimitedJson(`https://api.github.com/repos/${owner}/${repo}`);
  if (!response.data || !isRecord(response.data)) return {};
  const data = response.data;
  return {
    repository: {
      owner,
      name: stringValue(data.name) || repo,
      fullName: stringValue(data.full_name) || `${owner}/${repo}`,
      description: stringValue(data.description) || undefined,
      language: stringValue(data.language) || undefined,
      stars: numberValue(data.stargazers_count),
      forks: numberValue(data.forks_count),
      topics: Array.isArray(data.topics) ? data.topics.map(stringValue).filter(Boolean).slice(0, 8) : undefined,
      homepage: normalizeOptionalUrl(stringValue(data.homepage)),
      license: isRecord(data.license) ? stringValue(data.license.spdx_id) || stringValue(data.license.name) : undefined,
      defaultBranch: stringValue(data.default_branch) || undefined,
      pushedAt: stringValue(data.pushed_at) || undefined
    }
  };
}

async function fetchPageMetadata(url: URL): Promise<FetchResourceMetadataResult> {
  const response = await fetchLimitedText(url.toString(), ["text/html", "text/plain", "text/markdown"]);
  if (!response.text) return { error: response.error };

  const contentType = response.contentType.toLowerCase();
  if (contentType.includes("html")) {
    const title = readHtmlTitle(response.text);
    const description = readHtmlMeta(response.text, ["description", "og:description", "twitter:description"]);
    const siteName = readHtmlMeta(response.text, ["og:site_name"]) ?? url.hostname.replace(/^www\./, "");
    const ogImage = resolveUrl(readHtmlMeta(response.text, ["og:image"]), response.url);
    const twitterImage = resolveUrl(readHtmlMeta(response.text, ["twitter:image"]), response.url);
    const iconUrl = resolveUrl(readHtmlIcon(response.text), response.url);
    const images = compactImages([
      ogImage ? { label: "Open Graph", url: ogImage, source: "og" } : undefined,
      twitterImage ? { label: "Twitter preview", url: twitterImage, source: "twitter" } : undefined,
      iconUrl ? { label: "Site icon", url: iconUrl, source: "icon" } : undefined,
      ...extractHtmlImages(response.text, response.url)
    ]);
    const imageUrl = images?.find((image) => image.source !== "icon")?.url ?? images?.[0]?.url;
    const textSample = trimText(extractReadableHtmlText(response.text), 4_000);
    return {
      metadata: {
        title: title ?? siteName,
        description: description ?? firstUsefulParagraph(textSample),
        siteName,
        fetchedUrl: response.url,
        imageUrl,
        iconUrl,
        images,
        textSample,
        links: extractKeyLinks(response.text, response.url)
      }
    };
  }

  const text = normalizeWhitespace(response.text);
  return {
    metadata: {
      title: inferTitleFromUrl(url),
      description: firstUsefulParagraph(text),
      siteName: url.hostname.replace(/^www\./, ""),
      fetchedUrl: response.url,
      textSample: trimText(text, 4_000)
    }
  };
}

async function fetchLimitedText(url: string, acceptedTypes: string[]): Promise<{ text?: string; contentType: string; url: string; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: acceptedTypes.join(", "),
        "user-agent": "Dev-Cockpit-Resource-Radar/1.0"
      },
      redirect: "follow"
    });
    const contentType = response.headers.get("content-type") ?? "";
    const finalUrl = response.url || url;
    if (!response.ok) return { contentType, url: finalUrl, error: `HTTP ${response.status}` };
    if (!isAcceptedContentType(contentType, acceptedTypes)) return { contentType, url: finalUrl, error: `Unsupported content type: ${contentType || "unknown"}` };
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_METADATA_BYTES) return { contentType, url: finalUrl, error: "Response is too large to summarize" };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_METADATA_BYTES) return { contentType, url: finalUrl, error: "Response is too large to summarize" };
    return { text: new TextDecoder("utf-8", { fatal: false }).decode(buffer), contentType, url: finalUrl };
  } catch (error) {
    return { contentType: "", url, error: readableError(error) };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchLimitedJson(url: string): Promise<{ data?: unknown; error?: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        accept: "application/vnd.github+json, application/json",
        "user-agent": "Dev-Cockpit-Resource-Radar/1.0"
      },
      redirect: "follow"
    });
    if (!response.ok) return { error: `HTTP ${response.status}` };
    const contentLength = Number(response.headers.get("content-length") ?? "0");
    if (contentLength > MAX_GITHUB_JSON_BYTES) return { error: "Response is too large to summarize" };
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > MAX_GITHUB_JSON_BYTES) return { error: "Response is too large to summarize" };
    return { data: JSON.parse(new TextDecoder("utf-8", { fatal: false }).decode(buffer)) };
  } catch (error) {
    return { error: readableError(error) };
  } finally {
    clearTimeout(timer);
  }
}

function isAcceptedContentType(contentType: string, acceptedTypes: string[]): boolean {
  if (!contentType) return true;
  const normalized = contentType.toLowerCase();
  return acceptedTypes.some((accepted) => normalized.includes(accepted));
}

function parseHttpUrl(value: string): URL | undefined {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url : undefined;
  } catch {
    return undefined;
  }
}

function readHtmlTitle(html: string): string | undefined {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  return title ? decodeHtml(normalizeWhitespace(title)) : undefined;
}

function readHtmlMeta(html: string, names: string[]): string | undefined {
  for (const name of names) {
    const escaped = escapeRegExp(name);
    const pattern = new RegExp(`<meta\\s+[^>]*(?:name|property)=["']${escaped}["'][^>]*content=["']([^"']+)["'][^>]*>`, "i");
    const reversePattern = new RegExp(`<meta\\s+[^>]*content=["']([^"']+)["'][^>]*(?:name|property)=["']${escaped}["'][^>]*>`, "i");
    const value = html.match(pattern)?.[1] ?? html.match(reversePattern)?.[1];
    if (value) return decodeHtml(normalizeWhitespace(value));
  }
  return undefined;
}

function readHtmlIcon(html: string): string | undefined {
  const match = html.match(/<link\s+[^>]*rel=["'][^"']*(?:icon|apple-touch-icon)[^"']*["'][^>]*href=["']([^"']+)["'][^>]*>/i);
  return match?.[1];
}

function extractMarkdownImages(markdown: string, baseUrl: string): ResourceImage[] {
  const images: ResourceImage[] = [];
  for (const match of markdown.matchAll(/!\[([^\]]*)]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const url = normalizeImageUrl(match[2], baseUrl);
    if (!url) continue;
    images.push({ label: trimText(match[1]?.trim() || inferImageLabel(url), 48), url, source: "readme" });
    if (images.length >= 6) break;
  }
  const htmlPattern = /<img\s+[^>]*src=["\']([^"\']+)["\'][^>]*>/gi;
  let htmlMatch: RegExpExecArray | null;
  while ((htmlMatch = htmlPattern.exec(markdown)) && images.length < 8) {
    const url = normalizeImageUrl(htmlMatch[1], baseUrl);
    if (!url) continue;
    const alt = readHtmlAttribute(htmlMatch[0], "alt");
    images.push({ label: trimText(alt || inferImageLabel(url), 48), url, source: "readme" });
  }
  return images;
}

function extractHtmlImages(html: string, baseUrl: string): ResourceImage[] {
  const images: ResourceImage[] = [];
  const pattern = /<img\s+[^>]*src=["\']([^"\']+)["\'][^>]*>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && images.length < 8) {
    const url = normalizeImageUrl(match[1], baseUrl);
    if (!url) continue;
    const label = readHtmlAttribute(match[0], "alt") || readHtmlAttribute(match[0], "aria-label") || inferImageLabel(url);
    images.push({ label: trimText(label, 48), url, source: "page" });
  }
  return images;
}

function compactImages(images: Array<ResourceImage | undefined>): ResourceImage[] | undefined {
  const seen = new Set<string>();
  const output: ResourceImage[] = [];
  for (const image of images) {
    const url = normalizeImageUrl(image?.url, "https://example.invalid/");
    if (!image || !url || seen.has(url)) continue;
    seen.add(url);
    output.push({ label: trimText(image.label || inferImageLabel(url), 48), url, source: image.source });
    if (output.length >= 10) break;
  }
  return output.length > 0 ? output : undefined;
}

function normalizeImageUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value || /^data:|^blob:|^javascript:/i.test(value)) return undefined;
  const url = resolveUrl(value, baseUrl);
  if (!url || !/^https?:\/\//i.test(url)) return undefined;
  return url;
}

function readHtmlAttribute(tag: string, attribute: string): string | undefined {
  const pattern = new RegExp(`${attribute}=["\']([^"\']+)["\']`, "i");
  const value = tag.match(pattern)?.[1];
  return value ? decodeHtml(normalizeWhitespace(value)) : undefined;
}

function inferImageLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const leaf = parsed.pathname.split("/").filter(Boolean).pop();
    return leaf ? leaf.replace(/[-_]+/g, " ").replace(/\.[a-z0-9]+$/i, "") : parsed.hostname.replace(/^www\./, "");
  } catch {
    return "Preview image";
  }
}

function githubOpenGraphImage(owner: string, repo: string): string {
  return `https://opengraph.githubassets.com/dev-cockpit/${owner}/${repo}`;
}
function extractKeyLinks(html: string, baseUrl: string): Array<{ label: string; url: string }> | undefined {
  const links: Array<{ label: string; url: string }> = [];
  const pattern = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(html)) && links.length < 8) {
    const href = resolveUrl(match[1], baseUrl);
    if (!href) continue;
    const label = normalizeWhitespace(decodeHtml(match[2].replace(/<[^>]+>/g, " ")));
    if (!isKeyLink(label, href)) continue;
    if (links.some((link) => link.url === href)) continue;
    links.push({ label: trimText(label || inferLinkLabel(href), 40), url: href });
  }
  return links.length > 0 ? links : undefined;
}

function isKeyLink(label: string, href: string): boolean {
  const haystack = `${label} ${href}`.toLowerCase();
  return /github|demo|docs?|documentation|quickstart|guide|tutorial|example|playground|showcase|pricing|api|download|安装|文档|教程|演示|示例|源码/.test(haystack);
}

function inferLinkLabel(url: string): string {
  try {
    const parsed = new URL(url);
    if (/github\.com/i.test(parsed.hostname)) return "GitHub";
    const leaf = parsed.pathname.split("/").filter(Boolean).pop();
    return leaf ? leaf.replace(/[-_]+/g, " ") : parsed.hostname.replace(/^www\./, "");
  } catch {
    return "Link";
  }
}

function extractReadableHtmlText(html: string): string {
  return normalizeWhitespace(
    decodeHtml(
      html
        .replace(/<script[\s\S]*?<\/script>/gi, " ")
        .replace(/<style[\s\S]*?<\/style>/gi, " ")
        .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
        .replace(/<[^>]+>/g, " ")
    )
  );
}

function stripMarkdownNoise(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/!\[[^\]]*]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<img\b[^>]*>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/^\s*>\s?/gm, "")
    .replace(/^#{1,6}\s+/gm, "");
}

function firstUsefulParagraph(text: string): string {
  const paragraph = text
    .split(/\n\s*\n|\r?\n/)
    .map((part) => normalizeWhitespace(part.replace(/[*_`~]+/g, " ")))
    .find((part) => part.length >= 40 && !looksLikeReadmeChrome(part));
  return trimText(paragraph ?? normalizeWhitespace(text), 220);
}

function looksLikeReadmeChrome(value: string): boolean {
  const normalized = value.toLowerCase();
  if (/^(english|中文|docs|documentation|license|demo|preview)(\s*[·|/]\s*)+/i.test(value)) return true;
  if ((normalized.match(/\b(badge|license|stars|fork|npm|build)\b/g) ?? []).length >= 2) return true;
  return false;
}

function inferTitleFromUrl(url: URL): string {
  const leaf = url.pathname.split("/").filter(Boolean).pop();
  return leaf ? leaf.replace(/\.[a-z0-9]+$/i, "").replace(/[-_]+/g, " ") : url.hostname.replace(/^www\./, "");
}

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function trimText(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 1).trim()}…`;
}

function resolveUrl(value: string | undefined, baseUrl: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return undefined;
  }
}

function compactLinks(links: Array<{ label: string; url: string } | undefined>): Array<{ label: string; url: string }> | undefined {
  const seen = new Set<string>();
  const output: Array<{ label: string; url: string }> = [];
  for (const link of links) {
    if (!link?.url || seen.has(link.url)) continue;
    seen.add(link.url);
    output.push(link);
  }
  return output.length > 0 ? output : undefined;
}

function normalizeOptionalUrl(value: string): string | undefined {
  if (!value) return undefined;
  try {
    return new URL(value).toString();
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function numberValue(value: unknown): number | undefined {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) && numeric >= 0 ? Math.round(numeric) : undefined;
}

function decodeHtml(value: string): string {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.name === "AbortError" ? "Fetch timed out" : error.message;
  return String(error);
}
