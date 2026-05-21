import path from "node:path";
import type { FileSystemAdapter } from "../../adapters.js";
import type { Command } from "../../types.js";
import { command, inferCommandKind, parseJsonText } from "./common.js";

export async function detectPhpCommands(projectPath: string, markers: string[], fs: FileSystemAdapter): Promise<Command[]> {
  const commands: Command[] = [];
  if (markers.includes("artisan")) {
    commands.push(command("php-laravel-serve", "Laravel serve", "php", ["artisan", "serve", "--host", "127.0.0.1", "--port", "8000"], projectPath, "detected", "dev"));
  }
  if (markers.includes("composer.json")) {
    commands.push(...(await readComposerScripts(projectPath, fs)));
  }
  return commands;
}

async function readComposerScripts(projectPath: string, fs: FileSystemAdapter): Promise<Command[]> {
  try {
    const raw = await fs.readFile(path.join(projectPath, "composer.json"));
    const parsed = parseJsonText<{ scripts?: Record<string, unknown> }>(raw);
    return Object.entries(parsed.scripts ?? {})
      .filter(([scriptName]) => /^(dev|serve|start|test|build)$/i.test(scriptName))
      .map(([scriptName]) => command(`composer-${scriptName}`, `Composer ${scriptName}`, "composer", ["run", scriptName], projectPath, "package-script", inferCommandKind(scriptName)));
  } catch {
    return [];
  }
}
