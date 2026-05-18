import path from "node:path";
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
    expect(vueProject?.commands.find((command) => command.id === "script-dev")?.args).toEqual(["run", "dev"]);
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
});
