import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cliRoot = path.join(repoRoot, "packages", "cli");
const cliDist = path.join(cliRoot, "dist");
const webDist = path.join(repoRoot, "apps", "web", "dist");
const bundledWebDist = path.join(cliDist, "web");

await fs.rm(cliDist, { recursive: true, force: true });
await fs.mkdir(cliDist, { recursive: true });

await build({
  entryPoints: [path.join(cliRoot, "src", "index.ts")],
  outfile: path.join(cliDist, "index.js"),
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  external: ["commander", "ws", "zod"],
  sourcemap: true,
  logLevel: "info"
});

await fs.cp(webDist, bundledWebDist, { recursive: true });

try {
  await fs.chmod(path.join(cliDist, "index.js"), 0o755);
} catch {
  // chmod is best-effort on Windows and only matters when the package runs on POSIX.
}
