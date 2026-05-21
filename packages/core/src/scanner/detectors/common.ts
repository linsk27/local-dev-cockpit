import path from "node:path";
import type { FileSystemAdapter } from "../../adapters.js";
import type { Command } from "../../types.js";

export function command(
  id: string,
  label: string,
  executable: string,
  args: string[],
  cwd: string,
  source: Command["source"],
  kind: Command["kind"],
  ports: number[] = []
): Command {
  return { id, label, command: executable, args, ports: ports.length > 0 ? ports : undefined, cwd, source, kind };
}

export function inferCommandKind(name: string): Command["kind"] {
  const normalized = name.toLowerCase();
  if (normalized.includes("test")) return "test";
  if (normalized.includes("build")) return "build";
  if (normalized.includes("start")) return "start";
  if (normalized.includes("dev") || normalized.includes("serve")) return "dev";
  return "custom";
}

export function parseJsonText<T>(raw: string): T {
  return JSON.parse(raw.replace(/^\uFEFF/, "")) as T;
}

export async function resolveProjectExecutable(projectPath: string, fs: FileSystemAdapter, wrapperNames: string[], fallback: string): Promise<string> {
  for (const wrapperName of wrapperNames) {
    const wrapperPath = path.join(projectPath, wrapperName);
    if (await fs.exists(wrapperPath)) return wrapperPath;
  }
  return fallback;
}

export function extractPortNumbersFromText(text: string): number[] {
  const ports = new Set<number>();
  const patterns = [
    /(?:--(?:port|server\.port)(?:=|\s+)|-p\s+|(?:^|\s)[A-Z_]*PORT=)(\d{2,5})/gi,
    /(?:https?:\/\/)?(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0):(\d{2,5})/gi
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const port = Number(match[1]);
      if (Number.isInteger(port) && port > 0 && port < 65536) ports.add(port);
    }
  }
  return [...ports];
}
