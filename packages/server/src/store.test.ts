import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { JsonStore, rootId } from "./store.js";

describe("JsonStore roots", () => {
  it("removes roots by stable URL-safe id", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-store-"));
    const paths = {
      dataDir: tmp,
      configPath: path.join(tmp, "config.json"),
      statePath: path.join(tmp, "state.json"),
      logsDir: path.join(tmp, "logs")
    };
    const store = new JsonStore(paths, tmp);
    const root = path.join(tmp, "root one");

    await store.addRoot(root);
    const afterRemove = await store.removeRoot(rootId(path.resolve(root)));

    expect(afterRemove.roots).not.toContain(path.resolve(root));
  });
});
