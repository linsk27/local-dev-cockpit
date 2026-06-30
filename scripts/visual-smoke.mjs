import { mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baseUrl = process.env.DEV_COCKPIT_BASE_URL ?? "http://127.0.0.1:8787";
const outputDir = path.join(root, ".artifacts", "visual-smoke");

let chromium;
try {
  ({ chromium } = await import("playwright"));
} catch {
  console.error("[visual-smoke] Playwright is not installed. Run `pnpm add -Dw playwright` before this visual check.");
  process.exit(1);
}

await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch();
try {
  await verifyViewport("desktop", { width: 1440, height: 900 });
  await verifyViewport("mobile", { width: 390, height: 844 });
  console.log(`[visual-smoke] ok ${baseUrl}`);
} finally {
  await browser.close();
}

async function verifyViewport(name, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => {
    consoleErrors.push(error.message);
  });

  try {
    await verifyPage(page, `${baseUrl}/`, ".dashboard-grid, .onboarding-panel, .empty-state", `${name}-projects.png`);
    await verifyPage(
      page,
      `${baseUrl}/resources?verify=visual-smoke`,
      ".resource-finder-workbench, .resource-nebula-page",
      `${name}-resources.png`
    );
    if (consoleErrors.length > 0) {
      throw new Error(`${name} console errors:\n${consoleErrors.join("\n")}`);
    }
  } finally {
    await context.close();
  }
}

async function verifyPage(page, url, selector, screenshotName) {
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30000 });
  await page.waitForSelector(selector, { timeout: 15000 });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth + 1);
  if (overflow) throw new Error(`${url} has horizontal overflow`);
  await page.screenshot({ path: path.join(outputDir, screenshotName), fullPage: true });
}
