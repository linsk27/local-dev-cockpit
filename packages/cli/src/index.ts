#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import {
  analyzeProject,
  NodeFileSystemAdapter,
  NodeProcessAdapter,
  renderAgentsFile,
  renderProjectContext,
  scanRoot
} from "@local-dev-cockpit/core";
import { diagnoseCommandEnvironment, JsonStore, resolveAppPaths, startDevCockpitServer } from "@local-dev-cockpit/server";

const CLI_VERSION = "0.1.5";

const program = new Command()
  .name("local-dev-cockpit")
  .description("Dev Cockpit: local project dashboard for processes, logs, Git state, ports, and AI context.")
  .version(CLI_VERSION);

const DOCTOR_BINARIES = [
  { name: "git", args: ["--version"], required: true },
  { name: "node", args: ["--version"], required: true },
  { name: "python", args: ["--version"], required: false },
  { name: "conda", args: ["--version"], required: false },
  { name: "docker", args: ["--version"], required: false },
  { name: "go", args: ["version"], required: false },
  { name: "cargo", args: ["--version"], required: false },
  { name: "mvn", args: ["--version"], required: false },
  { name: "gradle", args: ["--version"], required: false },
  { name: "php", args: ["--version"], required: false },
  { name: "composer", args: ["--version"], required: false },
  { name: "ruby", args: ["--version"], required: false },
  { name: "bundle", args: ["--version"], required: false },
  { name: "dotnet", args: ["--version"], required: false }
] as const;

program
  .command("serve", { isDefault: true })
  .description("Start the local dashboard.")
  .option("--port <port>", "Preferred local port.", parseIntOption, 8787)
  .option("--no-open", "Do not open the browser automatically.")
  .action(async (options: { port: number; open: boolean }) => {
    const webRoot = resolveWebRoot();
    const server = await startDevCockpitServer({ port: options.port, webRoot, version: CLI_VERSION });
    const url = `http://localhost:${server.port}`;
    process.stdout.write(`Dev Cockpit is running at ${url}\n`);
    if (options.open) {
      openBrowser(url);
    }
  });

program
  .command("scan")
  .description("Scan a directory for local projects.")
  .argument("<dir>", "Root directory to scan.")
  .action(async (dir: string) => {
    const result = await scanRoot(dir);
    process.stdout.write(`Found ${result.projects.length} project(s) in ${result.root}\n`);
    for (const project of result.projects) {
      process.stdout.write(`- ${project.name} [${project.kind}] ${project.path}\n`);
    }
    for (const warning of result.warnings) {
      process.stderr.write(`warning: ${warning}\n`);
    }
  });

program
  .command("add-root")
  .description("Add a project root directory to the dashboard.")
  .argument("<dir>", "Root directory to add.")
  .action(async (dir: string) => {
    const store = new JsonStore(resolveAppPaths(), process.cwd());
    const config = await store.addRoot(dir);
    process.stdout.write(`Configured roots:\n${config.roots.map((root) => `- ${root}`).join("\n")}\n`);
  });

program
  .command("doctor")
  .description("Check local dependencies used by Dev Cockpit.")
  .argument("[projectPath]", "Optional project path for command environment diagnostics.")
  .action(async (projectPath?: string) => {
    const checks = await Promise.all(DOCTOR_BINARIES.map((item) => checkBinary(item.name, item.args, item.required)));
    process.stdout.write("Dev Cockpit doctor\n\n");
    process.stdout.write("Local runtimes\n");
    for (const check of checks) {
      process.stdout.write(`${check.ok ? "[ok]" : check.required ? "[missing]" : "[optional]"} ${check.name}${check.version ? ` - ${check.version}` : ""}\n`);
    }

    if (projectPath) {
      const project = await analyzeProject(path.resolve(projectPath), {
        fs: new NodeFileSystemAdapter(),
        process: new NodeProcessAdapter()
      });
      process.stdout.write(`\nProject: ${project.name} [${project.kind}]\n`);
      process.stdout.write(`Path: ${project.path}\n`);
      if (project.commands.length === 0) {
        process.stdout.write("No runnable command detected for this project.\n");
        return;
      }
      process.stdout.write("\nCommand environments\n");
      for (const command of project.commands) {
        const diagnostic = await diagnoseCommandEnvironment(command);
        const status = diagnostic.status === "ready" ? "ok" : diagnostic.status;
        process.stdout.write(`[${status}] ${diagnostic.label}: ${diagnostic.summary}\n`);
        process.stdout.write(`       ${diagnostic.detail}\n`);
      }
    }
  });

program
  .command("context")
  .description("Generate AI context for a project.")
  .argument("<projectPath>", "Project path.")
  .option("--write", "Write PROJECT_CONTEXT.md and AGENTS.md into the project.", false)
  .action(async (projectPath: string, options: { write: boolean }) => {
    const project = await analyzeProject(path.resolve(projectPath), {
      fs: new NodeFileSystemAdapter(),
      process: new NodeProcessAdapter()
    });
    const context = renderProjectContext(project);
    const agents = renderAgentsFile(project);
    if (options.write) {
      await fs.writeFile(path.join(project.path, "PROJECT_CONTEXT.md"), context, "utf8");
      await fs.writeFile(path.join(project.path, "AGENTS.md"), agents, "utf8");
      process.stdout.write(`Wrote PROJECT_CONTEXT.md and AGENTS.md in ${project.path}\n`);
    } else {
      process.stdout.write(`${context}\n`);
    }
  });

program.parseAsync(process.argv).catch((error: unknown) => {
  process.stderr.write(`local-dev-cockpit failed: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});

function parseIntOption(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid number: ${value}`);
  }
  return parsed;
}

function resolveWebRoot(): string {
  const current = path.dirname(fileURLToPath(import.meta.url));
  const bundledWeb = path.join(current, "web");
  if (existsSync(path.join(bundledWeb, "index.html"))) return bundledWeb;
  return path.resolve(current, "../../../apps/web/dist");
}

function openBrowser(url: string): void {
  const command =
    process.platform === "win32"
      ? "cmd"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  const args = process.platform === "win32" ? ["/c", "start", "", url] : [url];
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", () => {
    // Opening a browser is best-effort; the CLI still prints the URL for manual use.
  });
  child.unref();
}

async function checkBinary(name: string, args: readonly string[], required: boolean): Promise<{ name: string; ok: boolean; required: boolean; version?: string }> {
  const adapter = new NodeProcessAdapter();
  const result = await adapter.execFile(name, [...args], { timeoutMs: 2500 });
  return {
    name,
    required,
    ok: result.exitCode === 0,
    version: result.exitCode === 0 ? result.stdout.trim().split(/\r?\n/)[0] || result.stderr.trim().split(/\r?\n/)[0] : undefined
  };
}
