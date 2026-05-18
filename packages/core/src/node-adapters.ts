import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import net from "node:net";
import { promisify } from "node:util";
import type { FileSystemAdapter, ProcessAdapter } from "./adapters.js";

const execFileAsync = promisify(execFile);

export class NodeFileSystemAdapter implements FileSystemAdapter {
  async readdir(path: string) {
    const entries = await fs.readdir(path, { withFileTypes: true });
    return entries.map((entry) => ({
      name: entry.name,
      isDirectory: entry.isDirectory(),
      isFile: entry.isFile()
    }));
  }

  async readFile(path: string): Promise<string> {
    return fs.readFile(path, "utf8");
  }

  async exists(path: string): Promise<boolean> {
    try {
      await fs.access(path);
      return true;
    } catch {
      return false;
    }
  }

  async stat(path: string) {
    const stat = await fs.stat(path);
    return { isDirectory: stat.isDirectory(), isFile: stat.isFile() };
  }
}

export class NodeProcessAdapter implements ProcessAdapter {
  async execFile(command: string, args: string[], options: { cwd?: string; timeoutMs?: number } = {}) {
    try {
      const result = await execFileAsync(command, args, {
        cwd: options.cwd,
        timeout: options.timeoutMs ?? 6000,
        windowsHide: true,
        maxBuffer: 8 * 1024 * 1024
      });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
    } catch (error) {
      const failure = error as Error & { stdout?: string; stderr?: string; code?: number };
      return {
        stdout: failure.stdout ?? "",
        stderr: failure.stderr ?? failure.message,
        exitCode: typeof failure.code === "number" ? failure.code : 1
      };
    }
  }

  async isPortOpen(port: number, host = "127.0.0.1"): Promise<boolean> {
    return new Promise((resolve) => {
      const socket = net.createConnection({ port, host });
      const done = (open: boolean) => {
        socket.removeAllListeners();
        socket.destroy();
        resolve(open);
      };
      socket.setTimeout(700);
      socket.once("connect", () => done(true));
      socket.once("timeout", () => done(false));
      socket.once("error", () => done(false));
    });
  }
}

