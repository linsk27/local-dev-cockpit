import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { AppPaths } from "../../paths.js";
import { analyzeSkillInput } from "./analyzer.js";
import { testAiConnection } from "./ai.js";
import { createSkillContext, createSkillDraft } from "./context.js";
import { fetchResourceMetadata } from "./fetcher.js";
import { SkillRadarStore } from "./store.js";
import { createTaxonomyPatch } from "./taxonomy.js";

let tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.map((dir) => fs.rm(dir, { recursive: true, force: true })));
  tempDirs = [];
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.DEV_COCKPIT_AI_API_KEY;
  delete process.env.DEV_COCKPIT_AI_BASE_URL;
  delete process.env.DEV_COCKPIT_AI_MODEL;
});

describe("Skill Radar analyzer", () => {
  it("creates a Skill.md card from frontmatter", () => {
    const skill = analyzeSkillInput({
      sourceUrl: "https://github.com/greensock/gsap-skills/blob/main/skills/gsap-core/SKILL.md",
      sourceText: ["---", "name: gsap-core", "description: Use GSAP core animation patterns safely.", "tags: [gsap, animation, vue]", "---", "", "# GSAP Core"].join("\n")
    });

    expect(skill).toMatchObject({
      title: "gsap-core",
      kind: "skill-md",
      category: "Skills / 前端开发",
      categoryPath: ["Skills", "前端开发"],
      taxonomySource: "rules",
      status: "inbox",
      confidence: 94
    });
    expect(skill.tags).toEqual(expect.arrayContaining(["gsap", "animation", "vue"]));
  });

  it("keeps WeChat-style text as a prompt clue instead of throwing", () => {
    const skill = analyzeSkillInput({
      sourceText: "视频号看到一个提示词：让 Codex 先扫描仓库，再输出可执行计划。适合项目初始化。"
    });

    expect(skill.kind).toBe("prompt");
    expect(skill.categoryPath).toEqual(["Prompt"]);
    expect(skill.summary).toContain("视频号");
  });

  it("classifies hosted demo links separately from articles", () => {
    const skill = analyzeSkillInput({
      sourceUrl: "https://mirofish-demo.pages.dev/",
      sourceText: "MiroFish Demo\n后续评估它是否值得沉淀成技能、工具或工作流参考。"
    });

    expect(skill).toMatchObject({
      title: "MiroFish Demo",
      kind: "demo",
      categoryPath: ["Demo"],
      confidence: 74
    });
    expect(skill.tags).toEqual(expect.arrayContaining(["demo"]));
  });

  it("uses concrete taxonomy for common collected resource text", () => {
    const skill = analyzeSkillInput({
      sourceText: "视频号收藏：一个 AI 自动给短视频生成字幕并支持剪辑导出的工具，适合自媒体视频剪辑。"
    });

    expect(skill).toMatchObject({
      kind: "tool",
      categoryPath: ["工具", "视频剪辑"],
      taxonomySource: "rules"
    });
  });

  it("keeps real GitHub resource examples in distinct taxonomy buckets", () => {
    const reactBits = analyzeSkillInput({
      sourceUrl: "https://github.com/DavidHDev/react-bits",
      sourceText: "The largest creative library of animated React components for text, backgrounds, and UI."
    });
    const articraft = analyzeSkillInput({
      sourceUrl: "https://github.com/mattzh72/articraft",
      sourceText: "An agentic system for scalable articulated 3D asset generation. GitHub page also contains generic clone buttons."
    });
    const mirofish = analyzeSkillInput({
      sourceUrl: "https://github.com/666ghj/MiroFish",
      sourceText: "简洁通用的群体智能引擎，预测万物。"
    });
    const huashu = analyzeSkillInput({
      sourceUrl: "https://github.com/alchaincyf/huashu-design",
      sourceText: "Say one sentence to your agent and get a finished design."
    });

    expect(reactBits.categoryPath).toEqual(["工具", "前端开发"]);
    expect(articraft.categoryPath).toEqual(["工具", "3D生成"]);
    expect(mirofish.categoryPath).toEqual(["工具", "预测模拟"]);
    expect(huashu.categoryPath).toEqual(["工具", "视觉设计"]);
  });

  it("does not let GitHub resources become Workflow just because AI over-labels them", () => {
    expect(
      createTaxonomyPatch({
        kind: "github-repo",
        categoryPath: ["Workflow", "前端开发"],
        taxonomySource: "ai"
      }).categoryPath
    ).toEqual(["工具", "前端开发"]);
  });

  it("uses fetched metadata to improve rule cards", () => {
    const skill = analyzeSkillInput(
      { sourceUrl: "https://example.com/demo" },
      {
        metadata: {
          title: "Example Demo",
          description: "A compact demo that shows a useful product interaction.",
          textSample: "Example Demo helps developers understand a reusable interaction pattern."
        }
      }
    );

    expect(skill).toMatchObject({
      title: "Example Demo",
      analysisSource: "metadata"
    });
    expect(skill.summary).toContain("compact demo");
  });
});

describe("Resource metadata fetcher", () => {
  it("extracts basic metadata from HTML pages", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          '<!doctype html><html><head><title>MiroFish</title><meta name="description" content="Demo page for AI product interaction"><meta property="og:image" content="/preview.png"></head><body><main>MiroFish demo shows a clean product flow for developers.</main><img src="/hero.jpg" alt="Hero preview"><a href="/docs">Docs</a></body></html>',
          { status: 200, headers: { "content-type": "text/html" } }
        );
      })
    );

    await expect(fetchResourceMetadata("https://mirofish-demo.pages.dev/")).resolves.toMatchObject({
      metadata: {
        title: "MiroFish",
        description: "Demo page for AI product interaction",
        imageUrl: "https://mirofish-demo.pages.dev/preview.png",
        images: expect.arrayContaining([
          { label: "Open Graph", url: "https://mirofish-demo.pages.dev/preview.png", source: "og" },
          { label: "Hero preview", url: "https://mirofish-demo.pages.dev/hero.jpg", source: "page" }
        ]),
        links: [{ label: "Docs", url: "https://mirofish-demo.pages.dev/docs" }]
      }
    });
  });

  it("extracts GitHub repository metadata and a preview image", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("api.github.com/repos/DavidHDev/react-bits")) {
          return new Response(
            JSON.stringify({
              name: "react-bits",
              full_name: "DavidHDev/react-bits",
              description: "Animated React components for creative interfaces.",
              stargazers_count: 1234,
              forks_count: 56,
              language: "TypeScript",
              topics: ["react", "animation"],
              homepage: "https://reactbits.dev",
              license: { spdx_id: "MIT" },
              default_branch: "main",
              pushed_at: "2026-05-01T00:00:00Z"
            }),
            { status: 200, headers: { "content-type": "application/json" } }
          );
        }
        return new Response("# React Bits\n\n![Preview](./assets/preview.png)\n\nThe largest creative library of animated React components.", {
          status: 200,
          headers: { "content-type": "text/plain" }
        });
      })
    );

    await expect(fetchResourceMetadata("https://github.com/DavidHDev/react-bits")).resolves.toMatchObject({
      metadata: {
        title: "react-bits",
        imageUrl: "https://opengraph.githubassets.com/dev-cockpit/DavidHDev/react-bits",
        images: expect.arrayContaining([
          { label: "GitHub preview", url: "https://opengraph.githubassets.com/dev-cockpit/DavidHDev/react-bits", source: "github-open-graph" },
          { label: "Preview", url: "https://raw.githubusercontent.com/DavidHDev/react-bits/HEAD/assets/preview.png", source: "readme" }
        ]),
        repository: {
          fullName: "DavidHDev/react-bits",
          language: "TypeScript",
          stars: 1234
        }
      }
    });
  });
});

describe("SkillRadarStore", () => {
  it("persists, updates, and removes skills with a separate JSON file", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const store = new SkillRadarStore(await createPaths());
    const skill = await store.create({ sourceUrl: "https://github.com/anthropics/skills" });

    expect(await store.get(skill.id)).toMatchObject({ kind: "skill-md" });

    const updated = await store.update(skill.id, { status: "useful", tags: ["agent", "skill"] });
    expect(updated).toMatchObject({ status: "useful", tags: ["agent", "skill"] });

    expect(await store.remove(skill.id)).toBe(true);
    expect(await store.list()).toEqual([]);
  });

  it("previews a resource without writing it to the library", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("not found", { status: 404, headers: { "content-type": "text/plain" } })));
    const store = new SkillRadarStore(await createPaths());
    const preview = await store.preview({ sourceUrl: "https://github.com/Lum1104/Understand-Anything" });

    expect(preview).toMatchObject({ kind: "tool", status: "inbox" });
    await expect(store.list()).resolves.toEqual([]);
  });

  it("commits a reviewed preview as the exact stored resource card", async () => {
    const store = new SkillRadarStore(await createPaths());
    const preview = analyzeSkillInput({ sourceText: "A prompt workflow for collecting AI resources." });

    const committed = await store.commitPreview({ preview });

    expect(committed).toMatchObject({ id: preview.id, title: preview.title, kind: preview.kind });
    await expect(store.get(preview.id)).resolves.toMatchObject({ id: preview.id, title: preview.title });
  });

  it("runs optional AI analysis during import when a key is configured", async () => {
    process.env.DEV_COCKPIT_AI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "AI Enhanced Resource",
                    kind: "tool",
                    category: "Tool",
                    categoryPath: ["前端开发", "动画交互"],
                    tags: ["ai", "resource"],
                    summary: "AI produced a structured resource card during import.",
                    confidence: 91
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const store = new SkillRadarStore(await createPaths());
    const skill = await store.create({ sourceText: "A useful AI resource manager idea." });

    expect(skill).toMatchObject({
      title: "AI Enhanced Resource",
      kind: "tool",
      analysisSource: "ai",
      categoryPath: ["工具", "前端开发"],
      confidence: 91,
      analysisError: undefined
    });
  });

  it("uses local AI settings for import preview without requiring environment variables", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "Configured AI Resource",
                    kind: "demo",
                    category: "Demo",
                    categoryPath: ["产品案例", "Demo"],
                    tags: ["ai", "preview"],
                    summary: "The local AI configuration generated this preview.",
                    confidence: 88
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const store = new SkillRadarStore(await createPaths());
    const preview = await store.preview(
      { sourceText: "A demo resource that should be classified during preview." },
      {
        aiSettings: {
          provider: "openai-compatible",
          providerId: "custom",
          baseUrl: "https://api.example.test/v1",
          model: "test-model",
          outputLocale: "en-US",
          apiKey: "local-key"
        }
      }
    );

    expect(preview).toMatchObject({
      title: "Configured AI Resource",
      analysisSource: "ai",
      categoryPath: ["Demo"],
      confidence: 88
    });
    await expect(store.list()).resolves.toEqual([]);
  });

  it("coerces AI taxonomy into resource form plus concrete topic", async () => {
    process.env.DEV_COCKPIT_AI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(
          JSON.stringify({
            choices: [
              {
                message: {
                  content: JSON.stringify({
                    title: "MiroFish",
                    kind: "github-repo",
                    categoryPath: ["多智能体仿真", "预测"],
                    tags: ["agent", "prediction", "simulation", "ai", "tool", "demo", "extra"],
                    summary: "A repository for prediction simulation.",
                    confidence: 90
                  })
                }
              }
            ]
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      })
    );

    const store = new SkillRadarStore(await createPaths());
    const preview = await store.preview({ sourceUrl: "https://github.com/666ghj/MiroFish" });

    expect(preview).toMatchObject({
      title: "MiroFish",
      kind: "tool",
      categoryPath: ["工具", "预测模拟"],
      taxonomySource: "ai"
    });
    expect(preview.tags.length).toBeLessThanOrEqual(6);
  });

  it("tests OpenAI-compatible settings without exposing the API key", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: "OK" } }] }), { status: 200 }))
    );

    const result = await testAiConnection({
      provider: "openai-compatible",
      providerId: "rayinai",
      baseUrl: "https://api.example.test/v1",
      model: "resource-parser",
      outputLocale: "zh-CN",
      apiKey: "secret-key"
    });

    expect(result).toMatchObject({
      ok: true,
      providerId: "rayinai",
      baseUrl: "https://api.example.test/v1",
      model: "resource-parser"
    });
    expect(JSON.stringify(result)).not.toContain("secret-key");
    expect(fetch).toHaveBeenCalledWith(
      "https://api.example.test/v1/chat/completions",
      expect.objectContaining({
        headers: expect.objectContaining({ authorization: "Bearer secret-key" })
      })
    );
  });

  it("reports missing AI key during connection tests", async () => {
    await expect(
      testAiConnection({
        provider: "openai-compatible",
        providerId: "custom",
        baseUrl: "https://api.example.test/v1",
        model: "resource-parser",
        outputLocale: "zh-CN",
        apiKey: ""
      })
    ).resolves.toMatchObject({ ok: false, error: expect.stringContaining("API Key") });
  });

  it("returns an empty list when the skill file is damaged", async () => {
    const paths = await createPaths();
    await fs.writeFile(path.join(paths.dataDir, "skill-radar.json"), "{bad json", "utf8");

    await expect(new SkillRadarStore(paths).list()).resolves.toEqual([]);
  });

  it("normalizes legacy category while reading existing data", async () => {
    const paths = await createPaths();
    const item = {
      ...analyzeSkillInput({ sourceUrl: "https://github.com/example/resource" }),
      category: "Legacy",
      categoryPath: undefined,
      taxonomySource: undefined
    };
    await fs.writeFile(path.join(paths.dataDir, "skill-radar.json"), JSON.stringify({ version: 1, items: [item] }), "utf8");

    await expect(new SkillRadarStore(paths).list()).resolves.toMatchObject([{ category: "工具 / Legacy", categoryPath: ["工具", "Legacy"] }]);
  });

  it("generates AI context and a draft SKILL.md", async () => {
    const skill = analyzeSkillInput({
      sourceText: "---\nname: repo-reader\ndescription: Read a repository before editing.\n---"
    });

    expect(createSkillContext(skill).context).toContain("Resource Radar Context");
    expect(createSkillDraft(skill).draft).toContain("## When to use");
  });

  it("generates kind-specific output for demo resources", () => {
    const demo = analyzeSkillInput({ sourceUrl: "https://mirofish-demo.pages.dev/" });

    expect(createSkillDraft(demo).draft).toContain("Demo Analysis");
  });

  it("keeps rule analysis when AI key is not configured", async () => {
    const store = new SkillRadarStore(await createPaths());
    const skill = await store.create({ sourceText: "A prompt workflow for summarizing AI resources." });

    await expect(store.analyze(skill.id)).resolves.toMatchObject({
      id: skill.id,
      analysisError: expect.stringContaining("未配置 AI Key")
    });
  });

  it("rejects invalid AI output without corrupting the card", async () => {
    process.env.DEV_COCKPIT_AI_API_KEY = "test-key";
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        return new Response(JSON.stringify({ choices: [{ message: { content: '{"bad":true}' } }] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        });
      })
    );
    const store = new SkillRadarStore(await createPaths());
    const skill = await store.create({ sourceText: "A demo resource for testing invalid AI output." });

    await expect(store.analyze(skill.id)).resolves.toMatchObject({
      id: skill.id,
      title: skill.title,
      analysisError: "AI 返回结构不符合资源卡片 schema，已使用规则预览。"
    });
  });
});

async function createPaths(): Promise<AppPaths> {
  const dataDir = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-skill-"));
  tempDirs.push(dataDir);
  return {
    dataDir,
    configPath: path.join(dataDir, "config.json"),
    statePath: path.join(dataDir, "state.json"),
    logsDir: path.join(dataDir, "logs")
  };
}
