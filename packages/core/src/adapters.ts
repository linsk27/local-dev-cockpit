/**
 * File system adapter used by the scanner. Keeping it small makes the scanner
 * testable without touching the real disk.
 */
export interface FileSystemAdapter {
  readdir(path: string): Promise<Array<{ name: string; isDirectory: boolean; isFile: boolean }>>;
  readFile(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  stat(path: string): Promise<{ isDirectory: boolean; isFile: boolean }>;
}

/**
 * Process adapter for Git and port-related system calls. The core package uses
 * command + args only; callers should never pass shell-composed strings.
 */
export interface ProcessAdapter {
  execFile(command: string, args: string[], options?: { cwd?: string; timeoutMs?: number }): Promise<{
    stdout: string;
    stderr: string;
    exitCode: number;
  }>;
  isPortOpen(port: number, host?: string): Promise<boolean>;
}

