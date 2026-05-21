import path from "node:path";
import { NodeProcessAdapter, type PortStatus, type Project } from "@local-dev-cockpit/core";

export const EXTERNAL_PORT_OWNER_CACHE_TTL_MS = 5_000;

export interface ExternalPortOwner {
  port: number;
  host?: string;
  pid: number;
  commandLine: string;
}

let externalPortOwnersCache: { expiresAt: number; owners: ExternalPortOwner[] } | undefined;
let externalPortOwnersInflight: Promise<ExternalPortOwner[]> | undefined;
let externalPortOwnersCacheVersion = 0;

export function invalidateExternalPortOwnersCache(): void {
  externalPortOwnersCacheVersion += 1;
  externalPortOwnersCache = undefined;
  externalPortOwnersInflight = undefined;
}

export async function getCachedExternalPortOwners(processAdapter: NodeProcessAdapter): Promise<ExternalPortOwner[]> {
  const now = Date.now();
  if (externalPortOwnersCache && externalPortOwnersCache.expiresAt > now) return externalPortOwnersCache.owners;
  if (externalPortOwnersInflight) return externalPortOwnersInflight;

  const cacheVersion = externalPortOwnersCacheVersion;
  externalPortOwnersInflight = detectExternalPortOwners(processAdapter)
    .then((owners) => {
      if (cacheVersion === externalPortOwnersCacheVersion) {
        externalPortOwnersCache = { expiresAt: Date.now() + EXTERNAL_PORT_OWNER_CACHE_TTL_MS, owners };
      }
      return owners;
    })
    .finally(() => {
      if (cacheVersion === externalPortOwnersCacheVersion) {
        externalPortOwnersInflight = undefined;
      }
    });
  return externalPortOwnersInflight;
}

export function mapExternalPortClaims(externalPortOwnersByProject: Map<string, ExternalPortOwner[]>): Map<number, Set<string>> {
  const claims = new Map<number, Set<string>>();
  for (const [projectId, owners] of externalPortOwnersByProject) {
    for (const owner of owners) {
      const projectIds = claims.get(owner.port) ?? new Set<string>();
      projectIds.add(projectId);
      claims.set(owner.port, projectIds);
    }
  }
  return claims;
}

export function assignExternalPortOwners(projects: Project[], owners: ExternalPortOwner[]): Map<string, ExternalPortOwner[]> {
  const byProject = new Map<string, ExternalPortOwner[]>();
  for (const owner of owners) {
    const matches = projects
      .filter((project) => commandLineReferencesProject(owner.commandLine, project.path))
      .map((project) => ({
        project,
        pathLength: normalizePathText(path.resolve(project.path)).length
      }));
    if (matches.length === 0) continue;
    const bestLength = Math.max(...matches.map((match) => match.pathLength));
    for (const { project } of matches.filter((match) => match.pathLength === bestLength)) {
      byProject.set(project.id, [...(byProject.get(project.id) ?? []), owner]);
    }
  }
  return byProject;
}

export function countDetectedPortOwners(projects: Project[]): Map<number, number> {
  const ownersByPort = new Map<number, Set<string>>();
  for (const project of projects) {
    for (const port of project.ports) {
      if (port.source !== "detected") continue;
      const owners = ownersByPort.get(port.port) ?? new Set<string>();
      owners.add(project.id);
      ownersByPort.set(port.port, owners);
    }
  }
  return new Map([...ownersByPort.entries()].map(([port, owners]) => [port, owners.size]));
}

export function parseExternalPortOwners(raw: string): ExternalPortOwner[] {
  try {
    const parsed = JSON.parse(raw.trim()) as unknown;
    const rows = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return rows.flatMap((row) => {
      if (!row || typeof row !== "object") return [];
      const item = row as Record<string, unknown>;
      const port = Number(item.port);
      const pid = Number(item.pid);
      if (!Number.isInteger(port) || port <= 0 || port > 65535 || !Number.isInteger(pid)) return [];
      return [
        {
          port,
          pid,
          host: typeof item.host === "string" ? item.host : undefined,
          commandLine: typeof item.commandLine === "string" ? item.commandLine : ""
        }
      ];
    });
  } catch {
    return [];
  }
}

export function commandLineReferencesProject(commandLine: string, projectPath: string): boolean {
  const normalizedCommandLine = normalizePathText(commandLine);
  const normalizedProjectPath = normalizePathText(path.resolve(projectPath));
  if (!normalizedCommandLine || !normalizedProjectPath) return false;

  let index = normalizedCommandLine.indexOf(normalizedProjectPath);
  while (index >= 0) {
    const before = normalizedCommandLine[index - 1] ?? " ";
    const after = normalizedCommandLine[index + normalizedProjectPath.length] ?? " ";
    if (isPathBoundary(before, "before") && isPathBoundary(after, "after")) return true;
    index = normalizedCommandLine.indexOf(normalizedProjectPath, index + 1);
  }
  return false;
}

async function detectExternalPortOwners(processAdapter: NodeProcessAdapter): Promise<ExternalPortOwner[]> {
  if (process.platform !== "win32") return [];
  const script = [
    "$ErrorActionPreference = 'SilentlyContinue'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "$OutputEncoding = [System.Text.Encoding]::UTF8",
    "$processes = @{}",
    "Get-CimInstance Win32_Process | ForEach-Object { $processes[[int]$_.ProcessId] = $_.CommandLine }",
    "$connections = @(Get-NetTCPConnection -State Listen | Where-Object { @('127.0.0.1','::1','0.0.0.0','::') -contains $_.LocalAddress })",
    "$items = foreach ($connection in $connections) {",
    "  $pidValue = [int]$connection.OwningProcess",
    "  $commandLine = ''",
    "  if ($processes.ContainsKey($pidValue) -and $processes[$pidValue]) { $commandLine = [string]$processes[$pidValue] }",
    "  [pscustomobject]@{ port = [int]$connection.LocalPort; host = [string]$connection.LocalAddress; pid = $pidValue; commandLine = $commandLine }",
    "}",
    "@($items) | ConvertTo-Json -Compress"
  ].join("; ");
  const result = await processAdapter.execFile("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    timeoutMs: 8000
  });
  if (result.exitCode !== 0 || !result.stdout.trim()) return [];
  return parseExternalPortOwners(result.stdout);
}

function normalizePathText(value: string): string {
  return value.replace(/^\\\\\?\\/, "").replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/+$/g, "").toLowerCase();
}

function isPathBoundary(character: string, side: "before" | "after"): boolean {
  if (/[\s"'`]/.test(character)) return true;
  return side === "after" ? character === "/" : true;
}
