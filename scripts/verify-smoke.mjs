import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliEntry = path.join(root, "packages", "cli", "dist", "index.js");
const webEntry = path.join(root, "apps", "web", "dist", "index.html");

if (!existsSync(cliEntry) || !existsSync(webEntry)) {
  console.error("[smoke] Build output not found. Run `pnpm build` before `pnpm verify:smoke`.");
  process.exit(1);
}

const child = spawn(process.execPath, [cliEntry, "serve", "--port", "8798", "--no-open"], {
  cwd: root,
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let settled = false;
let stdout = "";
let stderr = "";

child.stdout.on("data", (chunk) => {
  stdout += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  stderr += chunk.toString();
});

try {
  const baseUrl = await waitForServerUrl();
  await expectJson(`${baseUrl}/api/health`, "health");
  await expectJson(`${baseUrl}/api/projects`, "projects");
  await expectJson(`${baseUrl}/api/skills/export`, "resource export");
  await expectHtml(`${baseUrl}/`, "web entry");
  console.log(`[smoke] ok ${baseUrl}`);
} catch (error) {
  console.error(`[smoke] failed: ${error instanceof Error ? error.message : String(error)}`);
  if (stderr.trim()) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  settled = true;
  child.kill();
}

async function waitForServerUrl() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    const match = stdout.match(/http:\/\/localhost:(\d+)/);
    if (match?.[1]) return `http://127.0.0.1:${match[1]}`;
    if (child.exitCode !== null) {
      throw new Error(`server exited early with code ${child.exitCode}`);
    }
    await delay(100);
  }
  throw new Error("server did not report a local URL within 15s");
}

async function expectJson(url, label) {
  const response = await fetchWithTimeout(url, label);
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  if (!contentType.includes("application/json")) {
    throw new Error(`${label} returned ${contentType || "unknown content-type"} instead of JSON`);
  }
  await response.json();
}

async function expectHtml(url, label) {
  const response = await fetchWithTimeout(url, label);
  const contentType = response.headers.get("content-type") ?? "";
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}`);
  if (!contentType.includes("text/html")) {
    throw new Error(`${label} returned ${contentType || "unknown content-type"} instead of HTML`);
  }
  const text = await response.text();
  if (!text.includes("<!doctype html>") && !text.includes("<html")) {
    throw new Error(`${label} did not look like an HTML app shell`);
  }
}

async function fetchWithTimeout(url, label) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error(`${label} timed out after 30s`)), 30000);
  try {
    return await fetch(url, { signal: controller.signal });
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`${label} timed out after 30s`);
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

process.on("exit", () => {
  if (!settled && child.exitCode === null) child.kill();
});
