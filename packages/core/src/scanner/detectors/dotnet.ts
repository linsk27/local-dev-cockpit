import type { Command } from "../../types.js";
import { command } from "./common.js";

export function detectDotnetCommands(projectPath: string, markers: string[]): Command[] {
  if (!markers.some((marker) => marker.endsWith(".csproj") || marker.endsWith(".sln"))) return [];
  return [
    command("dotnet-run", ".NET run", "dotnet", ["run"], projectPath, "detected", "dev"),
    command("dotnet-test", ".NET test", "dotnet", ["test"], projectPath, "detected", "test"),
    command("dotnet-build", ".NET build", "dotnet", ["build"], projectPath, "detected", "build")
  ];
}
