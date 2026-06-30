import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const currentDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@local-dev-cockpit/core": path.resolve(currentDir, "../core/src/index.ts")
    }
  }
});
