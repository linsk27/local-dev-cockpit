import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AppPaths } from "../../paths.js";
import { SkillRadarStore } from "./store.js";
import type { SkillItem } from "./types.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
});

describe("SkillRadarStore scale behavior", () => {
  it("imports 1000 resources with stable dedupe, failure counts, and summary statistics", async () => {
    const store = new SkillRadarStore(await createPaths());
    const items = Array.from({ length: 1000 }, (_, index) =>
      resource({
        id: `resource-${index}`,
        title: `Resource ${index}`,
        sourceUrl: `https://example.com/resources/${index}`,
        kind: index % 2 === 0 ? "tool" : "workflow",
        status: index % 4 === 0 ? "useful" : "inbox",
        category: index % 2 === 0 ? "工具 / 前端开发" : "Workflow / 自动化",
        categoryPath: index % 2 === 0 ? ["工具", "前端开发"] : ["Workflow", "自动化"],
        tags: index % 2 === 0 ? ["frontend"] : ["workflow"]
      })
    );
    items.push(
      resource({
        id: "duplicate-url",
        title: "Duplicate URL",
        sourceUrl: "https://example.com/resources/1",
        summary: "different summary"
      }),
      resource({
        id: "github-a",
        title: "GitHub Repo",
        sourceUrl: "https://github.com/example/repo"
      }),
      resource({
        id: "github-b",
        title: "GitHub Repo Issues",
        sourceUrl: "https://github.com/example/repo/issues"
      }),
      resource({
        id: "duplicate-fingerprint",
        title: "Resource 2",
        sourceUrl: "https://different.example.com/resource-2",
        summary: "summary"
      })
    );

    const result = await store.importData({
      app: "dev-cockpit-resource-radar",
      version: 1,
      items: [...items, { bad: true }]
    });

    expect(result).toMatchObject({
      added: 1001,
      skipped: 3,
      failed: 1,
      total: 1005
    });

    const summary = await store.summary();
    expect(summary.total).toBe(1001);
    expect(summary.statuses).toMatchObject({ inbox: 751, useful: 250 });
    expect(summary.kinds).toMatchObject({ tool: 501, workflow: 500 });
    expect(summary.categories).toEqual([
      {
        major: "工具",
        count: 501,
        children: [{ minor: "前端开发", count: 501 }]
      },
      {
        major: "Workflow",
        count: 500,
        children: [{ minor: "自动化", count: 500 }]
      }
    ]);
  });
});

async function createPaths(): Promise<AppPaths> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-skill-scale-"));
  tempDirs.push(dataDir);
  return {
    dataDir,
    configPath: path.join(dataDir, "config.json"),
    statePath: path.join(dataDir, "state.json"),
    logsDir: path.join(dataDir, "logs")
  };
}

function resource(overrides: Partial<SkillItem>): SkillItem {
  return {
    id: "resource",
    title: "Resource",
    kind: "tool",
    category: "工具 / 前端开发",
    categoryPath: ["工具", "前端开发"],
    tags: [],
    status: "inbox",
    confidence: 60,
    summary: "summary",
    createdAt: "2026-05-25T00:00:00.000Z",
    updatedAt: "2026-05-25T00:00:00.000Z",
    ...overrides
  };
}
