import path from "node:path";
import type { Command } from "@local-dev-cockpit/core";

export function extractLocalUrl(rawLog: string, position: "first" | "last" = "first"): string | undefined {
  const matches = [...rawLog.matchAll(/Local:\s*(https?:\/\/[^\s]+)/gi)].map((match) => match[1]?.trim()).filter(Boolean) as string[];
  if (matches.length === 0) return undefined;
  return position === "last" ? matches[matches.length - 1] : matches[0];
}

export function extractPort(rawLog: string): number | undefined {
  const patterns = [
    /address\s+\(['"]?[^'"),]+['"]?,\s*(\d{2,5})\)/i,
    /EADDRINUSE[^:\n]*(?::|port\s+)(\d{2,5})/i,
    /Port\s+(\d{2,5})\s+is in use/i,
    /localhost:(\d{2,5})/i,
    /127\.0\.0\.1:(\d{2,5})/i,
    /:(\d{2,5})\b/
  ];
  for (const pattern of patterns) {
    const port = Number(rawLog.match(pattern)?.[1]);
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  }
  return undefined;
}

export function extractHost(rawLog: string): string | undefined {
  return (
    rawLog.match(/address\s+\(['"]?([^'"),]+)['"]?,\s*\d{2,5}\)/i)?.[1]?.trim() ??
    rawLog.match(/address already in use\s+([^:\s]+):\d{2,5}/i)?.[1]?.trim()
  );
}

export function extractPid(rawLog: string): number | undefined {
  const pid = Number((rawLog.match(/PID:\s*(\d+)/i) ?? rawLog.match(/process\s+(\d+)/i))?.[1]);
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

export function extractKillCommand(rawLog: string): string | undefined {
  return rawLog
    .match(/Run\s+([^.\r\n]*taskkill[^.\r\n]*)/i)?.[1]
    ?.replace(/\s+to\s+stop\s+it$/i, "")
    .trim();
}

export function formatEndpoint(host: string | undefined, port: number | undefined): string {
  if (!port) return "未知端口";
  return `${host || "localhost"}:${port}`;
}

export function packageInstallCommand(command?: Command): string {
  const manager = command ? normalizeExecutableName(command.command) : undefined;
  switch (manager) {
    case "pnpm":
      return "pnpm install";
    case "yarn":
      return "yarn install";
    case "bun":
      return "bun install";
    case "npm":
    default:
      return "npm install";
  }
}

export function packageAddCommand(command: Command | undefined, packageName: string): string {
  const manager = command ? normalizeExecutableName(command.command) : undefined;
  switch (manager) {
    case "pnpm":
      return `pnpm add ${packageName}`;
    case "yarn":
      return `yarn add ${packageName}`;
    case "bun":
      return `bun add ${packageName}`;
    case "npm":
    default:
      return `npm install ${packageName}`;
  }
}

export function isLocalModuleReference(name: string): boolean {
  return name.startsWith(".") || name.startsWith("/") || name.startsWith("\\") || /^[A-Za-z]:[\\/]/.test(name);
}

export function formatShellToken(value: string): string {
  return /[\s"'`]/.test(value) ? `"${value.replace(/"/g, '\\"')}"` : value;
}

export function normalizeExecutableName(commandName: string): string {
  return path.basename(commandName).replace(/\.(cmd|bat|exe)$/i, "").toLowerCase();
}

export function isPathLikeCommand(commandName: string): boolean {
  return commandName.includes("/") || commandName.includes("\\") || /^[A-Za-z]:/.test(commandName);
}
