import type { Project } from "@local-dev-cockpit/core";
import { noCommandGuidance } from "./doctor-guidance.js";

/**
 * Formats one scanned project for terminal output without hiding why it is or
 * is not runnable.
 */
export function formatScanProject(project: Project): string[] {
  const lines = [`- ${project.name} [${project.kind}] ${project.path}`];
  if (project.commands.length > 0) {
    lines.push(`  commands: ${commandPreview(project)}`);
  } else {
    lines.push(`  hint: ${noCommandGuidance(project)}`);
  }
  if (project.ports.length > 0) {
    lines.push(`  ports: ${project.ports.map((port) => `${port.host ? `${port.host}:` : ""}${port.port} ${port.status}`).join(", ")}`);
  }
  return lines;
}

function commandPreview(project: Project): string {
  const preview = project.commands.slice(0, 4).map((command) => command.label);
  const remaining = project.commands.length - preview.length;
  return remaining > 0 ? `${preview.join(", ")} (+${remaining} more)` : preview.join(", ");
}
