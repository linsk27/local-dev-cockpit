import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { createRecoveryCard, renderProjectContext, scanRoot } from "./index.js";

const fixtureRoot = path.resolve("../../fixtures/projects");

describe("scanRoot", () => {
  it("discovers and identifies mixed local projects", async () => {
    const result = await scanRoot(fixtureRoot, { maxDepth: 2 });
    const names = result.projects.map((project) => project.name);

    expect(names).toContain("vue-app");
    expect(names).toContain("flask-api");
    expect(result.projects.find((project) => project.name === "vue-app")?.kind).toBe("node");
    expect(result.projects.find((project) => project.name === "flask-api")?.kind).toBe("python");
  });

  it("extracts package scripts as structured commands", async () => {
    const result = await scanRoot(fixtureRoot, { maxDepth: 2 });
    const vueProject = result.projects.find((project) => project.name === "vue-app");

    expect(vueProject?.commands.some((command) => command.id === "script-dev")).toBe(true);
    expect(vueProject?.commands.find((command) => command.id === "script-dev")?.args).toEqual([
      "run",
      "dev",
      "--",
      "--host",
      "127.0.0.1"
    ]);
    expect(vueProject?.commands.find((command) => command.id === "script-build")?.args).toEqual(["run", "build"]);
  });

  it("continues scanning inside Git shell repositories without root stack markers", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-scan-"));
    const repo = path.join(root, "git-shell");
    await fs.mkdir(path.join(repo, ".git"), { recursive: true });
    await fs.mkdir(path.join(repo, "frontend"), { recursive: true });
    await fs.mkdir(path.join(repo, "backend"), { recursive: true });
    await fs.writeFile(
      path.join(repo, "frontend", "package.json"),
      JSON.stringify({ name: "frontend", scripts: { dev: "vite --port 5174" } }),
      "utf8"
    );
    await fs.writeFile(path.join(repo, "backend", "requirements.txt"), "flask\n", "utf8");

    const result = await scanRoot(root, { maxDepth: 3 });
    const names = result.projects.map((project) => project.name);

    expect(names).toContain("git-shell");
    expect(names).toContain("frontend");
    expect(names).toContain("backend");
    expect(result.projects.find((project) => project.name === "frontend")?.kind).toBe("node");
    expect(result.projects.find((project) => project.name === "backend")?.kind).toBe("python");
  });

  it("renders recovery and AI context without external AI calls", async () => {
    const result = await scanRoot(fixtureRoot, { maxDepth: 2 });
    const project = result.projects.find((item) => item.name === "vue-app");
    expect(project).toBeTruthy();

    const card = createRecoveryCard(project!);
    const context = renderProjectContext(project!);

    expect(card.nextStep).toContain("dev");
    expect(context).toContain("## Commands");
    expect(context).toContain("npm run dev");
  });

  it("renders host-aware port endpoints in recovery and AI context", async () => {
    const result = await scanRoot(fixtureRoot, { maxDepth: 2 });
    const project = result.projects.find((item) => item.name === "vue-app");
    expect(project).toBeTruthy();

    const withRunningPort = {
      ...project!,
      ports: [{ port: 3000, host: "127.0.0.1", status: "open" as const, source: "process" as const }]
    };

    expect(createRecoveryCard(withRunningPort).summary).toContain("127.0.0.1:3000");
    expect(renderProjectContext(withRunningPort)).toContain("127.0.0.1:3000: open");
  });
});
