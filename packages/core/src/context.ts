import type { Project, RecoveryCard } from "./types.js";

export function createRecoveryCard(project: Project): RecoveryCard {
  const runningPort = project.ports.find((port) => port.status === "open" && port.source !== "common");
  const primaryCommand = project.commands.find((command) => command.kind === "dev") ?? project.commands[0];
  const dirtyTone = project.git.dirtyCount > 0 ? "warn" : "good";

  return {
    title: `${project.name} recovery`,
    summary: project.lastError
      ? `Last run failed: ${project.lastError.message}`
      : runningPort
        ? `Service appears active on port ${runningPort.port}.`
        : "No running service was detected yet.",
    nextStep: project.lastError
      ? "Open logs, fix the last error, then run the recommended dev command again."
      : primaryCommand
        ? `Run ${primaryCommand.label} to restore the project session.`
        : "Add a custom command or inspect the project README.",
    facts: [
      { label: "Stack", value: project.kind, tone: project.kind === "unknown" ? "warn" : "normal" },
      { label: "Branch", value: project.git.branch || "unknown" },
      { label: "Dirty files", value: String(project.git.dirtyCount), tone: dirtyTone },
      { label: "Commands", value: String(project.commands.length), tone: project.commands.length > 0 ? "good" : "warn" },
      {
        label: "Ports",
        value: project.ports
          .filter((port) => port.source !== "common" || port.status === "closed")
          .map((port) => `${port.port}:${port.status}`)
          .join(", ") || "none"
      }
    ]
  };
}

export function renderProjectContext(project: Project): string {
  const recovery = createRecoveryCard(project);
  const commands = project.commands
    .map((item) => `- ${item.label}: \`${[item.command, ...item.args].join(" ")}\` (${item.kind}, ${item.source})`)
    .join("\n");
  const ports = project.ports.map((item) => `- ${item.port}: ${item.status} (${item.source})`).join("\n");

  return `# ${project.name} Project Context

## Recovery

${recovery.summary}

Next step: ${recovery.nextStep}

## Project

- Path: ${project.path}
- Kind: ${project.kind}
- Markers: ${project.markers.join(", ") || "none"}

## Git

- Branch: ${project.git.branch}
- Dirty files: ${project.git.dirtyCount}
- Last commit: ${project.git.lastCommit ?? "unknown"}

## Commands

${commands || "- No commands detected yet."}

## Ports

${ports || "- No ports detected yet."}

## Notes For AI Agents

- Prefer existing commands above before inventing new ones.
- Do not modify project files unless the user explicitly asks.
- If a command fails, inspect logs before trying a different stack assumption.
`;
}

export function renderAgentsFile(project: Project): string {
  return `# AGENTS.md

This project is managed locally through Dev Cockpit.

## Start Here

${renderProjectContext(project)}
`;
}
