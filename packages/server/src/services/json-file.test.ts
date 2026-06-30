import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readJsonFile, writeJsonAtomic } from "./json-file.js";

describe("json-file", () => {
  it("writes JSON atomically and creates parent directories", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-json-file-"));
    const filePath = path.join(tmp, "nested", "settings.json");

    await writeJsonAtomic(filePath, { ok: true });

    await expect(readJsonFile(filePath, (value) => value as { ok: boolean }, () => ({ ok: false }))).resolves.toEqual({ ok: true });
  });

  it("returns fallback for damaged JSON", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-json-file-"));
    const filePath = path.join(tmp, "damaged.json");
    await fs.writeFile(filePath, "{bad json", "utf8");

    await expect(readJsonFile(filePath, (value) => value as { ok: boolean }, () => ({ ok: false }))).resolves.toEqual({ ok: false });
  });

  it("uses unique temp files during concurrent writes", async () => {
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-json-file-"));
    const filePath = path.join(tmp, "state.json");

    await Promise.all(Array.from({ length: 10 }, (_, index) => writeJsonAtomic(filePath, { index })));

    const files = await fs.readdir(tmp);
    expect(files).toEqual(["state.json"]);
    const parsed = JSON.parse(await fs.readFile(filePath, "utf8")) as { index: number };
    expect(parsed.index).toBeGreaterThanOrEqual(0);
    expect(parsed.index).toBeLessThan(10);
  });
});
