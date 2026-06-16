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
  if (process.platform === "win32") {
    const result = await execFileCapture(command, args, 10_000);
    if (result.errorCode === "ENOENT" || result.exitCode !== 0) {
      throw new Error(result.stderr.trim() || result.stdout.trim() || `Open folder failed with exit code ${result.exitCode}`);
    }
  } else {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    child.once("error", () => {
      // Opening a folder is best-effort. The API already validated the path.
    });
    child.unref();
  }
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
  if (platform === "win32") {
    const script = [
      "$ErrorActionPreference = 'Stop'",
      `$folderPath = ${quotePowerShellString(folderPath)}`,
      "Start-Process -FilePath explorer.exe -ArgumentList @(\"/e,$folderPath\")"
    ].join("; ");
    return { command: "powershell.exe", args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script] };
  }
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
  const command = await createResolvedEditorCommand(process.platform, editorCommand, folderPath);
  if (process.platform === "win32") {
    const launcher = createWindowsStartProcessCommand(command.command, command.args, folderPath);
    const result = await execFileCapture(launcher.command, launcher.args, 20_000);
    if (result.errorCode === "ENOENT" || result.exitCode !== 0) {
      const detail = result.stderr.trim() || result.stdout.trim() || `Editor command failed with exit code ${result.exitCode}`;
      throw new Error(detail);
    }
  } else {
    await spawnDetached(command.command, command.args);
  }
  return { opened: true, path: folderPath, command: editorCommand };
}

export async function createResolvedEditorCommand(
  platform: NodeJS.Platform,
  editorCommand: string,
  folderPath: string
): Promise<{ command: string; args: string[] }> {
  const parsed = parseEditorCommand(editorCommand);
  if (platform !== "win32") return createEditorCommandFromParsed(platform, parsed, folderPath);
  const command = await resolveWindowsEditorCommand(parsed.command);
  return createEditorCommandFromParsed(platform, { ...parsed, command, args: normalizeWindowsEditorArgs(command, parsed.args) }, folderPath);
}

export function createEditorCommand(platform: NodeJS.Platform, editorCommand: string, folderPath: string): { command: string; args: string[] } {
  return createEditorCommandFromParsed(platform, parseEditorCommand(editorCommand), folderPath);
}

function createEditorCommandFromParsed(
  platform: NodeJS.Platform,
  parsed: { command: string; args: string[] },
  folderPath: string
): { command: string; args: string[] } {
  if (platform !== "win32") {
    return { command: parsed.command, args: [...parsed.args, folderPath] };
  }
  if (isWindowsBatchCommand(parsed.command)) {
    return { command: "cmd.exe", args: ["/d", "/s", "/c", parsed.command, ...parsed.args, folderPath] };
  }
  if (isDirectWindowsExecutable(parsed.command)) {
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

function isWindowsBatchCommand(command: string): boolean {
  return /\.(?:cmd|bat)$/i.test(command);
}

async function resolveWindowsEditorCommand(command: string): Promise<string> {
  const appPathCommand = await resolveWindowsEditorFromAppPaths(command);
  if (appPathCommand) return appPathCommand;
  if (isDirectWindowsExecutable(command) || isWindowsBatchCommand(command)) return command;
  const result = await execFileCapture("where.exe", [command], 5_000);
  if (result.errorCode === "ENOENT" || result.exitCode !== 0) return command;
  const resolvedCommand = selectWindowsEditorExecutable(result.stdout);
  if (!resolvedCommand) return command;
  const guiExecutable = windowsGuiExecutableCandidateForShim(resolvedCommand);
  if (guiExecutable) {
    try {
      await fs.access(guiExecutable);
      return guiExecutable;
    } catch {
      // Fall through to the PATH-resolved shim when the adjacent GUI executable is absent.
    }
  }
  return resolvedCommand;
}

async function resolveWindowsEditorFromAppPaths(command: string): Promise<string | undefined> {
  const normalized = command.trim().toLowerCase();
  const appName = normalized === "code" ? "Code.exe" : normalized === "code-insiders" ? "Code - Insiders.exe" : "";
  if (!appName) return undefined;
  for (const hive of ["HKCU", "HKLM"]) {
    const result = await execFileCapture("reg.exe", ["query", `${hive}\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${appName}`, "/ve"], 5_000);
    if (result.exitCode !== 0) continue;
    const resolved = parseWindowsRegistryDefaultValue(result.stdout);
    if (resolved) return resolved;
  }
  return undefined;
}

export function parseWindowsRegistryDefaultValue(output: string): string | undefined {
  const line = output
    .split(/\r?\n/)
    .map((item) => item.trim())
    .find((item) => /\bREG_SZ\b/i.test(item));
  if (!line) return undefined;
  const match = line.match(/\bREG_SZ\b\s+(.+)$/i);
  return match?.[1]?.trim() || undefined;
}

export function selectWindowsEditorExecutable(output: string): string | undefined {
  const candidates = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    candidates.find((candidate) => /\.cmd$/i.test(candidate)) ??
    candidates.find((candidate) => /\.exe$/i.test(candidate)) ??
    candidates.find((candidate) => /\.bat$/i.test(candidate)) ??
    candidates[0]
  );
}

export function windowsGuiExecutableCandidateForShim(command: string): string | undefined {
  const basename = path.basename(command).toLowerCase();
  if (basename === "code.cmd" || basename === "code.bat") {
    return path.resolve(path.dirname(command), "..", "Code.exe");
  }
  if (basename === "code-insiders.cmd" || basename === "code-insiders.bat") {
    return path.resolve(path.dirname(command), "..", "Code - Insiders.exe");
  }
  return undefined;
}

function normalizeWindowsEditorArgs(command: string, args: string[]): string[] {
  if (!isVsCodeGuiExecutable(command)) return args;
  if (args.some((arg) => arg === "--new-window" || arg === "--reuse-window")) return args;
  return ["--new-window", ...args];
}

function isVsCodeGuiExecutable(command: string): boolean {
  return /^code(?: - insiders)?\.exe$/i.test(path.basename(command));
}

export function createWindowsStartProcessCommand(command: string, args: string[], workingDirectory: string): { command: string; args: string[] } {
  const argumentLine = args.map(quoteWindowsArgument).join(" ");
  const requiresTargetTitle = isVsCodeGuiExecutable(command);
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$filePath = ${quotePowerShellString(command)}`,
    `$arguments = ${quotePowerShellString(argumentLine)}`,
    `$workingDirectory = ${quotePowerShellString(workingDirectory)}`,
    `$requiresTargetTitle = ${requiresTargetTitle ? "$true" : "$false"}`,
    "$windowTitlePart = Split-Path -Leaf $workingDirectory",
    "$processName = [System.IO.Path]::GetFileNameWithoutExtension($filePath)",
    "$signature = '[DllImport(\"user32.dll\")] public static extern bool ShowWindowAsync(IntPtr hWnd, int nCmdShow); [DllImport(\"user32.dll\")] public static extern bool SetForegroundWindow(IntPtr hWnd);'",
    "Add-Type -MemberDefinition $signature -Name DevCockpitWindowFocus -Namespace Native -ErrorAction SilentlyContinue",
    "function Find-EditorWindow { Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -and $_.MainWindowTitle -ne 'OleMainThreadWndName' -and ($_.MainWindowTitle -like \"*$windowTitlePart*\" -or (-not $requiresTargetTitle -and $_.ProcessName -eq $processName)) } | Sort-Object StartTime -Descending | Select-Object -First 1 }",
    "function Wait-EditorWindow([int] $milliseconds) { $deadline = (Get-Date).AddMilliseconds($milliseconds); do { $target = Find-EditorWindow; if ($target) { return $target }; Start-Sleep -Milliseconds 200 } while ((Get-Date) -lt $deadline); return $null }",
    "Start-Process -FilePath $filePath -ArgumentList $arguments -WorkingDirectory $workingDirectory -WindowStyle Normal",
    "$target = Wait-EditorWindow 6500",
    "if ($target) { [void][Native.DevCockpitWindowFocus]::ShowWindowAsync($target.MainWindowHandle, 9); [void][Native.DevCockpitWindowFocus]::SetForegroundWindow($target.MainWindowHandle); exit 0 }",
    "throw \"Editor process started, but no visible editor window for '$windowTitlePart' was detected. Close blank editor windows and try again.\""
  ].join("; ");
  return {
    command: "powershell.exe",
    args: ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script]
  };
}

function quoteWindowsArgument(value: string): string {
  if (!value) return '""';
  if (!/[\s"]/u.test(value)) return value;
  let result = '"';
  let backslashes = 0;
  for (const char of value) {
    if (char === "\\") {
      backslashes += 1;
      continue;
    }
    if (char === '"') {
      result += "\\".repeat(backslashes * 2 + 1);
      result += '"';
      backslashes = 0;
      continue;
    }
    result += "\\".repeat(backslashes);
    result += char;
    backslashes = 0;
  }
  result += "\\".repeat(backslashes * 2);
  result += '"';
  return result;
}

function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { detached: true, stdio: "ignore", windowsHide: true });
    let settled = false;
    child.once("spawn", () => {
      settled = true;
      child.unref();
      resolve();
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    });
  });
}
