import { execFile, spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

export interface FolderPickerResult {
  canceled: boolean;
  path?: string;
}

export interface FolderPickerCommand {
  command: string;
  args: string[];
  cancelExitCodes: number[];
  description?: string;
  fallback?: FolderPickerCommand;
}

/**
 * Opens a project folder with the operating system's native file browser.
 * The API validates the path before spawning the best-effort external process.
 */
export async function openProjectFolder(folderPath: string): Promise<{ opened: true; path: string }> {
  const stat = await fs.stat(folderPath);
  if (!stat.isDirectory()) {
    throw new Error("Project path is not a directory");
  }
  const { command, args } = createOpenFolderCommand(process.platform, folderPath);
  const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", () => {
    // Opening a folder is best-effort. The API already validated the path.
  });
  child.unref();
  return { opened: true, path: folderPath };
}

/**
 * Opens the native folder picker and normalizes the selected result.
 * Platform-specific command fallbacks are contained here so route handlers stay simple.
 */
export async function chooseProjectRootFolder(initialPath?: string): Promise<FolderPickerResult> {
  const initialFolder = await resolveFolderPickerInitialPath(initialPath);
  const command = createFolderPickerCommand(process.platform, initialFolder);
  const result = await runNativeFolderPicker(command);
  if (!result) return { canceled: true };

  const resolved = path.resolve(result);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory()) {
    throw new Error("Selected path is not a directory");
  }
  return { canceled: false, path: resolved };
}

export function createOpenFolderCommand(platform: NodeJS.Platform, folderPath: string): { command: string; args: string[] } {
  if (platform === "win32") return { command: "explorer.exe", args: [folderPath] };
  if (platform === "darwin") return { command: "open", args: [folderPath] };
  return { command: "xdg-open", args: [folderPath] };
}

export function createFolderPickerCommand(platform: NodeJS.Platform, initialPath: string): FolderPickerCommand {
  if (platform === "win32") {
    return createWindowsFormsFolderPickerCommand(initialPath);
  }

  if (platform === "darwin") {
    const script = `POSIX path of (choose folder with prompt "Select project root" default location POSIX file "${escapeAppleScriptString(initialPath)}")`;
    return {
      command: "osascript",
      args: ["-e", script],
      cancelExitCodes: [1]
    };
  }

  return {
    command: "zenity",
    args: ["--file-selection", "--directory", "--title=Select project root", `--filename=${initialPath}${path.sep}`],
    cancelExitCodes: [1],
    fallback: {
      command: "kdialog",
      args: ["--getexistingdirectory", initialPath, "--title", "Select project root"],
      cancelExitCodes: [1]
    }
  };
}

function createWindowsFormsFolderPickerCommand(initialPath: string): FolderPickerCommand {
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    "Add-Type -AssemblyName System.Windows.Forms",
    "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
    "$dialog.Description = 'Select project root'",
    "$dialog.ShowNewFolderButton = $true",
    `$initialPath = ${quotePowerShellString(initialPath)}`,
    "if (Test-Path -LiteralPath $initialPath) { $dialog.SelectedPath = $initialPath }",
    "$result = $dialog.ShowDialog()",
    "if ($result -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath; exit 0 }",
    "exit 2"
  ].join("; ");
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
    cancelExitCodes: [2],
    description: "Windows Forms folder picker",
    fallback: createWindowsShellFolderPickerCommand(initialPath)
  };
}

function createWindowsShellFolderPickerCommand(initialPath: string): FolderPickerCommand {
  const script = [
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$initialPath = ${quotePowerShellString(initialPath)}`,
    "$shell = New-Object -ComObject Shell.Application",
    "$folder = $shell.BrowseForFolder(0, 'Select project root', 0, $initialPath)",
    "if ($folder -and $folder.Self -and $folder.Self.Path) { Write-Output $folder.Self.Path; exit 0 }",
    "exit 2"
  ].join("; ");
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-Command", script],
    cancelExitCodes: [2],
    description: "Windows Shell folder picker"
  };
}

export async function resolveFolderPickerInitialPath(initialPath?: string): Promise<string> {
  const candidate = initialPath?.trim();
  if (!candidate) return os.homedir();
  const resolved = path.resolve(candidate);
  try {
    const stat = await fs.stat(resolved);
    if (stat.isDirectory()) return resolved;
    if (stat.isFile()) return path.dirname(resolved);
  } catch {
    // Fall back to the home directory when the typed value is incomplete or invalid.
  }
  return os.homedir();
}

async function runNativeFolderPicker(command: FolderPickerCommand): Promise<string | undefined> {
  const result = await execFileCapture(command.command, command.args, 120_000);
  if (result.errorCode === "ENOENT") {
    if (command.fallback) return runNativeFolderPicker(command.fallback);
    throw new Error(`Folder picker command not found: ${command.command}`);
  }
  if (result.exitCode === 0) return normalizeFolderPickerOutput(result.stdout);
  if (command.cancelExitCodes.includes(result.exitCode)) return undefined;
  if (command.fallback) return runNativeFolderPicker(command.fallback);
  throw new Error(result.stderr.trim() || result.stdout.trim() || `Folder picker failed with exit code ${result.exitCode}`);
}

function normalizeFolderPickerOutput(output: string): string | undefined {
  const value = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
  return value || undefined;
}

function execFileCapture(
  command: string,
  args: string[],
  timeoutMs: number
): Promise<{ exitCode: number; stdout: string; stderr: string; errorCode?: string }> {
  return new Promise((resolve) => {
    execFile(command, args, { encoding: "utf8", timeout: timeoutMs, windowsHide: false, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
      resolve({
        exitCode: typeof code === "number" ? code : error ? 1 : 0,
        stdout: String(stdout ?? ""),
        stderr: String(stderr ?? ""),
        errorCode: typeof code === "string" ? code : undefined
      });
    });
  });
}

function quotePowerShellString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function escapeAppleScriptString(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Opens a project in the configured editor command without invoking a shell
 * unless Windows needs cmd.exe for PATH-resolved shims like `code`.
 */
export async function openProjectInEditor(folderPath: string, editorCommand: string): Promise<{ opened: true; path: string; command: string }> {
  const stat = await fs.stat(folderPath);
  if (!stat.isDirectory()) {
    throw new Error("Project path is not a directory");
  }
  const command = createEditorCommand(process.platform, editorCommand, folderPath);
  const child = spawn(command.command, command.args, { detached: true, stdio: "ignore", windowsHide: true });
  child.once("error", () => {
    // Opening an editor is best-effort. The UI reports the configured command for correction if needed.
  });
  child.unref();
  return { opened: true, path: folderPath, command: editorCommand };
}

export function createEditorCommand(platform: NodeJS.Platform, editorCommand: string, folderPath: string): { command: string; args: string[] } {
  const parsed = parseEditorCommand(editorCommand);
  if (platform !== "win32" || isDirectWindowsExecutable(parsed.command)) {
    return { command: parsed.command, args: [...parsed.args, folderPath] };
  }
  return { command: "cmd.exe", args: ["/d", "/s", "/c", parsed.command, ...parsed.args, folderPath] };
}

export function parseEditorCommand(editorCommand: string): { command: string; args: string[] } {
  const trimmed = editorCommand.trim();
  const windowsExecutablePath = trimmed.match(/^([A-Za-z]:\\.*?\.exe|\\\\.*?\.exe)(?:\s+(.*))?$/i);
  if (windowsExecutablePath?.[1]) {
    return {
      command: windowsExecutablePath[1],
      args: tokenizeCommandLine(windowsExecutablePath[2] ?? "")
    };
  }

  const [command, ...args] = tokenizeCommandLine(trimmed);
  if (!command) throw new Error("Editor command is empty");
  return { command, args };
}

function tokenizeCommandLine(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: '"' | "'" | undefined;
  for (const char of input.trim()) {
    if (quote) {
      if (char === quote) {
        quote = undefined;
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += char;
  }
  if (quote) throw new Error("Editor command has an unclosed quote");
  if (current) tokens.push(current);
  return tokens;
}

function isDirectWindowsExecutable(command: string): boolean {
  return /[\\/]/.test(command) || /\.exe$/i.test(command);
}
