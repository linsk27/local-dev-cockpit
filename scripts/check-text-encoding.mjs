import { promises as fs } from "node:fs";
import path from "node:path";

const root = process.cwd();
const ignoredDirs = new Set([".git", ".artifacts", "dist", "node_modules", "coverage"]);
const checkedExtensions = new Set([".css", ".html", ".js", ".json", ".md", ".mjs", ".ts", ".vue", ".yaml", ".yml"]);
const suspiciousFragments = [
  "璧勬簮",
  "椤圭洰",
  "绮樿创",
  "瑙ｆ瀽",
  "鍏ㄩ儴",
  "鎼滅储",
  "瀵煎叆",
  "瀵煎嚭",
  "鐘舵",
  "鍒嗙被",
  "涓婁笅鏂",
  "妫€鏌",
  "杩炴帴",
  "鍙戠幇",
  "宸叉",
  "娌℃湁",
  "鎵撳紑",
  "閰嶇疆",
  "鐢ㄤ簬",
  "路 {",
  "銆",
  "€?"
];

const findings = [];
for await (const filePath of walk(root)) {
  if (path.relative(root, filePath).replace(/\\/g, "/") === "scripts/check-text-encoding.mjs") continue;
  const text = await fs.readFile(filePath, "utf8");
  const lines = text.split(/\r?\n/);
  lines.forEach((line, index) => {
    const fragment = suspiciousFragments.find((candidate) => line.includes(candidate));
    if (fragment) {
      findings.push({ filePath, line: index + 1, fragment, text: line.trim().slice(0, 180) });
    }
  });
}

if (findings.length > 0) {
  console.error("Potential mojibake text found:");
  for (const finding of findings.slice(0, 40)) {
    console.error(`${path.relative(root, finding.filePath)}:${finding.line} contains ${JSON.stringify(finding.fragment)} -> ${finding.text}`);
  }
  if (findings.length > 40) console.error(`...and ${findings.length - 40} more`);
  process.exit(1);
}

console.log("Text encoding check passed.");

async function* walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith(".") && ignoredDirs.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!ignoredDirs.has(entry.name)) yield* walk(fullPath);
      continue;
    }
    if (!entry.isFile()) continue;
    if (!checkedExtensions.has(path.extname(entry.name))) continue;
    yield fullPath;
  }
}
