import type { FileSystemAdapter } from "../adapters.js";
import type { Command, Project } from "../types.js";
import { detectDotnetCommands } from "./detectors/dotnet.js";
import { detectJavaCommands } from "./detectors/java.js";
import { detectDockerCommands, detectGoCommands, detectRustCommands } from "./detectors/native.js";
import { detectNodeCommands, detectPackageManager } from "./detectors/node.js";
import { detectPhpCommands } from "./detectors/php.js";
import { detectPythonCommands } from "./detectors/python.js";
import { detectRubyCommands } from "./detectors/ruby.js";
import { extractPortNumbersFromText } from "./detectors/common.js";

export { detectPackageManager, extractPortNumbersFromText };

export async function detectCommands(
  projectPath: string,
  markers: string[],
  packageManager: Project["packageManager"],
  fs: FileSystemAdapter
): Promise<Command[]> {
  const commands: Command[] = [];

  if (markers.includes("package.json")) {
    commands.push(...(await detectNodeCommands(projectPath, packageManager, fs)));
  }
  commands.push(...(await detectPythonCommands(projectPath, markers, fs)));
  commands.push(...detectGoCommands(projectPath, markers));
  commands.push(...(await detectJavaCommands(projectPath, markers, fs)));
  commands.push(...(await detectPhpCommands(projectPath, markers, fs)));
  commands.push(...detectRubyCommands(projectPath, markers));
  commands.push(...detectDotnetCommands(projectPath, markers));
  commands.push(...detectRustCommands(projectPath, markers));
  commands.push(...detectDockerCommands(projectPath, markers));

  return dedupeCommands(commands);
}

function dedupeCommands(commands: Command[]): Command[] {
  const seen = new Set<string>();
  return commands.filter((item) => {
    const key = `${item.command}:${item.args.join(" ")}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
