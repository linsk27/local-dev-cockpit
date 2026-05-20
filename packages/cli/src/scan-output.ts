import type { PortStatus, Project } from "@local-dev-cockpit/core";
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
  const ports = visibleScanPorts(project.ports);
  if (ports.length > 0) {
    lines.push(`  ports: ${ports.map(formatPort).join(", ")}`);
  }
  return lines;
}

function commandPreview(project: Project): string {
  const preview = project.commands.slice(0, 4).map((command) => command.label);
  const remaining = project.commands.length - preview.length;
  return remaining > 0 ? `${preview.join(", ")} (+${remaining} more)` : preview.join(", ");
}

function visibleScanPorts(ports: PortStatus[]): PortStatus[] {
  return ports.filter((port) => port.source !== "common" && port.status !== "closed");
}

function formatPort(port: PortStatus): string {
  return `${port.host ? `${port.host}:` : ""}${port.port} ${port.status}`;
}
