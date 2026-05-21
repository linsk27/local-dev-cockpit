import os from "node:os";
import path from "node:path";

export function candidateEnvironmentBases(projectPath: string): string[] {
  const resolved = path.resolve(projectPath);
  const parent = path.dirname(resolved);
  return parent && parent !== resolved ? [resolved, parent] : [resolved];
}

export function candidatePythonInterpreterPaths(candidate: string, platform: NodeJS.Platform): string[] {
  const names = platform === "win32" ? ["Scripts/python.exe", "python.exe"] : ["bin/python", "python"];
  const basename = path.basename(candidate).toLowerCase();
  const candidateLooksExecutable =
    basename === "python" ||
    basename === "python.exe" ||
    basename === "python3" ||
    /^python\d+(\.\d+)?(\.exe)?$/.test(basename);
  return candidateLooksExecutable ? [candidate] : names.map((name) => path.join(candidate, name));
}

export function expandConfiguredPath(rawValue: string, workspacePath: string): string {
  let value = rawValue.trim().replace(/^['"]|['"]$/g, "");
  value = value.replace(/\$\{workspaceFolder(?::[^}]+)?\}|\$\{workspaceRoot\}/g, workspacePath);
  value = value.replace(/\$\{env:([^}]+)\}/g, (_match, name: string) => process.env[name] ?? "");
  value = value.replace(/%([^%]+)%/g, (_match, name: string) => process.env[name] ?? "");
  if (value === "~" || value.startsWith("~/") || value.startsWith("~\\")) {
    value = path.join(os.homedir(), value.slice(2));
  }
  return value;
}

export function describeEnvironmentPath(projectPath: string, interpreterPath: string): string {
  const relative = path.relative(projectPath, interpreterPath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? relative : interpreterPath;
}
