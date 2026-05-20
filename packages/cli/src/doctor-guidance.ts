interface DoctorProjectLike {
  kind: string;
  markers: string[];
  commands: Array<{ command: string }>;
}

/**
 * Returns the same actionable no-command guidance used by the dashboard,
 * but phrased for terminal diagnostics.
 */
export function noCommandGuidance(project: Pick<DoctorProjectLike, "kind" | "markers">): string {
  const hasMarker = (...markers: string[]) => markers.some((marker) => project.markers.includes(marker));

  if (project.kind === "node" || hasMarker("package.json")) {
    return "package.json was found, but no runnable scripts were detected. Add a dev/start script, or run doctor on the actual app directory.";
  }

  if (project.kind === "python" || hasMarker("requirements.txt", "pyproject.toml")) {
    if (hasMarker("requirements.txt", "pyproject.toml")) {
      return "Python dependency files were found, but no app entrypoint was detected. Check manage.py, app.py, main.py, app/main.py, src/app/main.py, or run doctor on the backend directory.";
    }
    return "Python markers were found, but no supported entrypoint was detected. Add a common entry file or run doctor on the backend directory.";
  }

  if (project.kind === "docker" || hasMarker("Dockerfile")) {
    return "Docker markers were found, but no compose command was detected. Add docker-compose.yml or compose.yml for one-command startup.";
  }

  if (project.kind === "unknown") {
    return "This looks like a repository shell without a known app marker. Try a child app folder such as frontend, backend, apps, packages, or services.";
  }

  return "Check project entry files or run doctor on a more specific app directory.";
}

export function shouldInspectPythonEnvironment(project: DoctorProjectLike): boolean {
  if (project.kind === "python" || project.kind === "mixed") return true;
  if (project.commands.some((command) => isPythonCommand(command.command))) return true;
  return project.markers.some((marker) =>
    ["requirements.txt", "requirements-dev.txt", "pyproject.toml", "environment.yml", "environment.yaml", "Pipfile", "poetry.lock"].includes(marker)
  );
}

function isPythonCommand(commandName: string): boolean {
  const normalized = commandName.replace(/^.*[\\/]/, "").replace(/\.(exe|cmd|bat)$/i, "").toLowerCase();
  return normalized === "python" || normalized === "python3" || normalized === "py";
}
