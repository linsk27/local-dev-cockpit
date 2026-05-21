import path from "node:path";
import type { FileSystemAdapter } from "../../adapters.js";
import type { Command } from "../../types.js";
import { command } from "./common.js";

const PYTHON_ENTRYPOINT_MARKERS = [
  "app/main.py",
  "src/app/main.py",
  "main.py",
  "src/main.py",
  "app.py",
  "src/app.py",
  "server.py",
  "api.py",
  "application.py",
  "wsgi.py",
  "asgi.py"
];

export async function detectPythonCommands(projectPath: string, markers: string[], fs: FileSystemAdapter): Promise<Command[]> {
  const commands: Command[] = [];
  if (markers.includes("manage.py")) {
    commands.push(command("python-django", "Django dev server", "python", ["manage.py", "runserver"], projectPath, "detected", "dev"));
  }
  const fastApiEntrypoint = await detectFastApiEntrypoint(projectPath, markers, fs);
  if (fastApiEntrypoint) {
    commands.push(command(`python-fastapi-${fastApiEntrypoint.module.replace(/\W/g, "-")}`, `Uvicorn ${fastApiEntrypoint.module}`, "python", ["-m", "uvicorn", `${fastApiEntrypoint.module}:app`, "--host", "127.0.0.1", "--port", "8000"], projectPath, "detected", "dev"));
  }
  const flaskEntrypoint = await detectFlaskEntrypoint(projectPath, markers, fs);
  if (flaskEntrypoint) {
    commands.push(command(`python-flask-${flaskEntrypoint.module.replace(/\W/g, "-")}`, `Flask ${flaskEntrypoint.module}`, "python", ["-m", "flask", "--app", flaskEntrypoint.module, "run", "--host", "127.0.0.1", "--port", "5000"], projectPath, "detected", "dev"));
  }
  if (markers.includes("run.py")) {
    commands.push(command("python-run", "Run run.py", "python", ["run.py"], projectPath, "detected", "dev"));
  }
  if (markers.includes("app.py") && !isDetectedPythonWebEntrypoint("app.py", fastApiEntrypoint, flaskEntrypoint)) {
    commands.push(command("python-app", "Run app.py", "python", ["app.py"], projectPath, "detected", "dev"));
  }
  if (markers.includes("main.py") && !isDetectedPythonWebEntrypoint("main.py", fastApiEntrypoint, flaskEntrypoint)) {
    commands.push(command("python-main", "Run main.py", "python", ["main.py"], projectPath, "detected", "dev"));
  }
  for (const marker of ["server.py", "api.py", "application.py"]) {
    if (markers.includes(marker) && !isDetectedPythonWebEntrypoint(marker, fastApiEntrypoint, flaskEntrypoint)) {
      commands.push(command(`python-${marker.replace(/\.py$/, "")}`, `Run ${marker}`, "python", [marker], projectPath, "detected", "dev"));
    }
  }
  return commands;
}

async function detectFastApiEntrypoint(projectPath: string, markers: string[], fs: FileSystemAdapter): Promise<{ marker: string; module: string } | undefined> {
  for (const marker of PYTHON_ENTRYPOINT_MARKERS) {
    if (!markers.includes(marker)) continue;
    try {
      const source = await fs.readFile(path.join(projectPath, marker));
      if (!/\bFastAPI\s*\(/.test(source)) continue;
      return { marker, module: pythonModuleName(marker) };
    } catch {
      // If an entrypoint disappears during scanning, skip it and continue.
    }
  }
  return undefined;
}

async function detectFlaskEntrypoint(projectPath: string, markers: string[], fs: FileSystemAdapter): Promise<{ marker: string; module: string } | undefined> {
  for (const marker of PYTHON_ENTRYPOINT_MARKERS) {
    if (!markers.includes(marker)) continue;
    try {
      const source = await fs.readFile(path.join(projectPath, marker));
      if (!/\bFlask\s*\(/.test(source) && !/\bfrom\s+flask\s+import\b|\bimport\s+flask\b/i.test(source)) continue;
      return { marker, module: pythonModuleName(marker) };
    } catch {
      // If an entrypoint disappears during scanning, skip it and continue.
    }
  }
  return undefined;
}

function isDetectedPythonWebEntrypoint(marker: string, fastApiEntrypoint?: { marker: string }, flaskEntrypoint?: { marker: string }): boolean {
  return fastApiEntrypoint?.marker === marker || flaskEntrypoint?.marker === marker;
}

function pythonModuleName(marker: string): string {
  return marker.replace(/\.py$/, "").replace(/[\\/]/g, ".");
}
