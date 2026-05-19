import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const desktopDist = path.join(desktopRoot, "dist");
const webDist = path.join(repoRoot, "apps", "web", "dist");
const bundledWebDist = path.join(desktopDist, "web");

await fs.rm(desktopDist, { recursive: true, force: true });
await fs.mkdir(desktopDist, { recursive: true });

await build({
  entryPoints: [path.join(desktopRoot, "src", "main.ts")],
  outfile: path.join(desktopDist, "main.cjs"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  external: ["electron"],
  sourcemap: true,
  logLevel: "info"
});

await fs.cp(webDist, bundledWebDist, { recursive: true });
