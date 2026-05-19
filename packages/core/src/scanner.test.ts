import path from "node:path";
import { promises as fs } from "node:fs";
import os from "node:os";
import { describe, expect, it } from "vitest";
import { createRecoveryCard, renderProjectContext, scanRoot } from "./index.js";
import type { ProcessAdapter } from "./adapters.js";

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

  it("passes Vite host arguments correctly for pnpm scripts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-pnpm-"));
    const projectPath = path.join(root, "pnpm-vite");
    await fs.mkdir(projectPath, { recursive: true });
    await fs.writeFile(path.join(projectPath, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n", "utf8");
    await fs.writeFile(
      path.join(projectPath, "package.json"),
      JSON.stringify({ name: "pnpm-vite", scripts: { dev: "vite", build: "vite build" } }),
      "utf8"
    );

    const result = await scanRoot(root, { maxDepth: 2 });
    const project = result.projects.find((item) => item.name === "pnpm-vite");

    expect(project?.commands.find((command) => command.id === "script-dev")?.args).toEqual([
      "run",
      "dev",
      "--host",
      "127.0.0.1"
    ]);
    expect(project?.commands.find((command) => command.id === "script-build")?.args).toEqual(["run", "build"]);
  });

  it("uses packageManager first and falls back to npm when package-lock and yarn.lock both exist", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-manager-"));
    const packageLockProject = path.join(root, "mixed-locks");
    const declaredProject = path.join(root, "declared-yarn");
    await fs.mkdir(packageLockProject, { recursive: true });
    await fs.mkdir(declaredProject, { recursive: true });
    await fs.writeFile(path.join(packageLockProject, "package-lock.json"), "{}", "utf8");
    await fs.writeFile(path.join(packageLockProject, "yarn.lock"), "", "utf8");
    await fs.writeFile(path.join(packageLockProject, "package.json"), JSON.stringify({ name: "mixed-locks", scripts: { dev: "vite" } }), "utf8");
    await fs.writeFile(path.join(declaredProject, "package-lock.json"), "{}", "utf8");
    await fs.writeFile(path.join(declaredProject, "yarn.lock"), "", "utf8");
    await fs.writeFile(
      path.join(declaredProject, "package.json"),
      JSON.stringify({ name: "declared-yarn", packageManager: "yarn@1.22.22", scripts: { dev: "vite" } }),
      "utf8"
    );

    const result = await scanRoot(root, { maxDepth: 2 });
    const mixedLocks = result.projects.find((item) => item.name === "mixed-locks");
    const declaredYarn = result.projects.find((item) => item.name === "declared-yarn");

    expect(mixedLocks?.packageManager).toBe("npm");
    expect(mixedLocks?.commands.find((command) => command.id === "script-dev")?.command).toBe("npm");
    expect(declaredYarn?.packageManager).toBe("yarn");
    expect(declaredYarn?.commands.find((command) => command.id === "script-dev")?.command).toBe("yarn");
  });

  it("hides dependency/cache packages that are not runnable projects", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-noise-"));
    const unityCachePackage = path.join(root, "UnityGame", "Library", "PackageCache", "com.unity.2d.animation@3.2.5");
    const packageOnlyFolder = path.join(root, "plain-package");
    const appFolder = path.join(root, "real-app");

    await fs.mkdir(unityCachePackage, { recursive: true });
    await fs.mkdir(packageOnlyFolder, { recursive: true });
    await fs.mkdir(appFolder, { recursive: true });
    await fs.writeFile(path.join(unityCachePackage, "package.json"), JSON.stringify({ name: "com.unity.2d.animation" }), "utf8");
    await fs.writeFile(path.join(packageOnlyFolder, "package.json"), JSON.stringify({ name: "plain-package" }), "utf8");
    await fs.writeFile(path.join(appFolder, "package.json"), JSON.stringify({ name: "real-app", scripts: { dev: "vite" } }), "utf8");

    const result = await scanRoot(root, { maxDepth: 6 });
    const names = result.projects.map((project) => project.name);

    expect(names).toContain("real-app");
    expect(names).not.toContain("com.unity.2d.animation@3.2.5");
    expect(names).not.toContain("plain-package");
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

  it("continues scanning inside Docker workspace roots and detects child apps", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-docker-workspace-"));
    const repo = path.join(root, "agent-workbench");
    await fs.mkdir(path.join(repo, "frontend"), { recursive: true });
    await fs.mkdir(path.join(repo, "backend", "app"), { recursive: true });
    await fs.writeFile(path.join(repo, "docker-compose.yml"), "services:\n  postgres:\n    image: postgres\n", "utf8");
    await fs.writeFile(
      path.join(repo, "frontend", "package.json"),
      JSON.stringify({ name: "frontend", scripts: { dev: "next dev" } }),
      "utf8"
    );
    await fs.writeFile(path.join(repo, "backend", "pyproject.toml"), "[project]\nname='backend'\n", "utf8");
    await fs.writeFile(path.join(repo, "backend", "app", "main.py"), "from fastapi import FastAPI\napp = FastAPI()\n", "utf8");

    const result = await scanRoot(root, { maxDepth: 4 });
    const names = result.projects.map((project) => project.name);
    const backend = result.projects.find((project) => project.name === "backend");

    expect(names).toContain("agent-workbench");
    expect(names).toContain("frontend");
    expect(names).toContain("backend");
    expect(backend?.commands.find((command) => command.id === "python-fastapi-app-main")?.args).toEqual([
      "-m",
      "uvicorn",
      "app.main:app",
      "--host",
      "127.0.0.1",
      "--port",
      "8000"
    ]);
  });

  it("detects run.py as a Python backend entrypoint", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-python-run-"));
    const backend = path.join(root, "api");
    await fs.mkdir(backend, { recursive: true });
    await fs.writeFile(path.join(backend, "requirements.txt"), "flask\n", "utf8");
    await fs.writeFile(path.join(backend, "run.py"), "print('running')\n", "utf8");

    const result = await scanRoot(root, { maxDepth: 2 });
    const project = result.projects.find((item) => item.name === "api");

    expect(project?.commands.find((command) => command.id === "python-run")?.args).toEqual(["run.py"]);
  });

  it("detects Maven Spring Boot projects and prefers the Maven wrapper", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-java-maven-"));
    const api = path.join(root, "spring-api");
    await fs.mkdir(api, { recursive: true });
    await fs.writeFile(path.join(api, "mvnw.cmd"), "@echo off\n", "utf8");
    await fs.writeFile(
      path.join(api, "pom.xml"),
      "<project><dependencies><dependency><artifactId>spring-boot-starter-web</artifactId></dependency></dependencies></project>",
      "utf8"
    );

    const result = await scanRoot(root, { maxDepth: 2 });
    const project = result.projects.find((item) => item.name === "spring-api");
    const bootRun = project?.commands.find((command) => command.id === "java-maven-spring-boot-run");

    expect(project?.kind).toBe("java");
    expect(bootRun?.command).toBe(path.join(api, "mvnw.cmd"));
    expect(bootRun?.args).toEqual(["spring-boot:run"]);
  });

  it("detects Gradle Spring Boot projects and prefers the Gradle wrapper", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-java-gradle-"));
    const api = path.join(root, "gradle-api");
    await fs.mkdir(api, { recursive: true });
    await fs.writeFile(path.join(api, "gradlew.bat"), "@echo off\n", "utf8");
    await fs.writeFile(path.join(api, "build.gradle"), "plugins { id 'org.springframework.boot' version '3.3.0' }\n", "utf8");

    const result = await scanRoot(root, { maxDepth: 2 });
    const project = result.projects.find((item) => item.name === "gradle-api");
    const bootRun = project?.commands.find((command) => command.id === "java-gradle-boot-run");

    expect(project?.kind).toBe("java");
    expect(bootRun?.command).toBe(path.join(api, "gradlew.bat"));
    expect(bootRun?.args).toEqual(["bootRun"]);
    expect(project?.commands.find((command) => command.id === "java-gradle-build")?.args).toEqual(["build"]);
  });

  it("detects Laravel projects and Composer scripts", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-php-"));
    const app = path.join(root, "laravel-app");
    await fs.mkdir(app, { recursive: true });
    await fs.writeFile(path.join(app, "artisan"), "#!/usr/bin/env php\n", "utf8");
    await fs.writeFile(path.join(app, "composer.json"), JSON.stringify({ scripts: { test: "phpunit", dev: "vite" } }), "utf8");

    const result = await scanRoot(root, { maxDepth: 2 });
    const project = result.projects.find((item) => item.name === "laravel-app");

    expect(project?.kind).toBe("php");
    expect(project?.commands.find((command) => command.id === "php-laravel-serve")?.args).toEqual([
      "artisan",
      "serve",
      "--host",
      "127.0.0.1",
      "--port",
      "8000"
    ]);
    expect(project?.commands.find((command) => command.id === "composer-test")?.args).toEqual(["run", "test"]);
  });

  it("detects Rails and .NET projects", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-ruby-dotnet-"));
    const rails = path.join(root, "rails-app");
    const dotnet = path.join(root, "dotnet-api");
    await fs.mkdir(path.join(rails, "bin"), { recursive: true });
    await fs.mkdir(dotnet, { recursive: true });
    await fs.writeFile(path.join(rails, "Gemfile"), "source 'https://rubygems.org'\n", "utf8");
    await fs.writeFile(path.join(rails, "bin", "rails"), "#!/usr/bin/env ruby\n", "utf8");
    await fs.writeFile(path.join(dotnet, "Api.csproj"), "<Project Sdk=\"Microsoft.NET.Sdk.Web\"></Project>\n", "utf8");

    const result = await scanRoot(root, { maxDepth: 3 });
    const railsProject = result.projects.find((item) => item.name === "rails-app");
    const dotnetProject = result.projects.find((item) => item.name === "dotnet-api");

    expect(railsProject?.kind).toBe("ruby");
    expect(railsProject?.commands.find((command) => command.id === "ruby-rails-server")?.args).toEqual([
      "exec",
      "rails",
      "server",
      "-b",
      "127.0.0.1",
      "-p",
      "3000"
    ]);
    expect(dotnetProject?.kind).toBe("dotnet");
    expect(dotnetProject?.commands.find((command) => command.id === "dotnet-run")?.args).toEqual(["run"]);
  });

  it("deduplicates common port probes during a single scan", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "dev-cockpit-port-cache-"));
    for (const name of ["app-a", "app-b"]) {
      const app = path.join(root, name);
      await fs.mkdir(app, { recursive: true });
      await fs.writeFile(path.join(app, "package.json"), JSON.stringify({ name, scripts: { dev: "vite" } }), "utf8");
    }

    const probes = new Map<string, number>();
    const processAdapter: ProcessAdapter = {
      async execFile() {
        return { stdout: "", stderr: "", exitCode: 0 };
      },
      async isPortOpen(port, host) {
        const key = `${host ?? "*"}:${port}`;
        probes.set(key, (probes.get(key) ?? 0) + 1);
        return false;
      }
    };

    const result = await scanRoot(root, { maxDepth: 2 }, { process: processAdapter });

    expect(result.projects.map((project) => project.name).sort()).toEqual(["app-a", "app-b"]);
    expect(probes.get("*:3000")).toBe(1);
    expect(probes.get("*:5173")).toBe(1);
    expect([...probes.values()].every((count) => count === 1)).toBe(true);
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
