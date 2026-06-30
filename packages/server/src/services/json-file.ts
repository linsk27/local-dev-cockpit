import { promises as fs } from "node:fs";
import path from "node:path";

export async function readJsonFile<T>(
  filePath: string,
  parse: (value: unknown) => T,
  fallback: () => T
): Promise<T> {
  try {
    return parse(JSON.parse(await fs.readFile(filePath, "utf8")));
  } catch {
    return fallback();
  }
}

export async function writeJsonAtomic(filePath: string, data: unknown): Promise<void> {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tempPath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
  await renameWithRetry(tempPath, filePath);
}

async function renameWithRetry(source: string, target: string): Promise<void> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    try {
      await fs.rename(source, target);
      return;
    } catch (error) {
      lastError = error;
      if (!isRetryableFileSystemError(error)) throw error;
      await delay(20 + attempt * 20);
    }
  }
  throw lastError;
}

function isRetryableFileSystemError(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
