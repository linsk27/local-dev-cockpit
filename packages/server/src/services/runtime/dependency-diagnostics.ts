import path from "node:path";
import type { Command } from "@local-dev-cockpit/core";
import { diagnoseJavaDependencyState, javaBuildToolFromCommand } from "./java.js";
import { diagnoseNodeDependencyState } from "./node.js";
import { diagnosePythonDependencyState } from "./python.js";
import {
  PACKAGE_MANAGER_COMMANDS,
  PYTHON_COMMANDS,
  type CommandResolutionOptions,
  directoryHasFileEnding,
  fileExists,
  normalizeExecutableName
} from "./shared.js";

export async function diagnoseProjectDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const normalized = normalizeExecutableName(command.command);
  if (PACKAGE_MANAGER_COMMANDS.has(normalized)) return diagnoseNodeDependencyState(command, options);
  if (PYTHON_COMMANDS.has(normalized)) return diagnosePythonDependencyState(command, options);
  const javaTool = javaBuildToolFromCommand(normalized);
  if (javaTool) return diagnoseJavaDependencyState(command, javaTool, options);
  if (normalized === "php" || normalized === "composer") return diagnosePhpDependencyState(command, options);
  if (normalized === "bundle" || normalized === "ruby") return diagnoseRubyDependencyState(command, options);
  if (normalized === "dotnet") return diagnoseDotnetDependencyState(command, options);
  return undefined;
}

async function diagnosePhpDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  const hasComposerJson = await fileExistsFn(path.join(command.cwd, "composer.json"));
  if (!hasComposerJson) return undefined;
  if (await fileExistsFn(path.join(command.cwd, "vendor", "autoload.php"))) return undefined;
  const commandName = normalizeExecutableName(command.command);
  if (commandName !== "php" && commandName !== "composer") return undefined;

  return {
    summary: "PHP 依赖可能尚未安装。",
    detail: "检测到 composer.json，但没有 vendor/autoload.php。首次运行 Laravel 或 Composer 脚本前建议执行：composer install。"
  };
}

async function diagnoseRubyDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  if (!(await fileExistsFn(path.join(command.cwd, "Gemfile")))) return undefined;
  if (await fileExistsFn(path.join(command.cwd, "Gemfile.lock"))) return undefined;
  const commandName = normalizeExecutableName(command.command);
  if (commandName !== "bundle" && commandName !== "ruby") return undefined;

  return {
    summary: "Ruby 依赖锁定文件缺失。",
    detail: "检测到 Gemfile，但没有 Gemfile.lock。首次运行 Rails/Rack 前建议执行：bundle install，并提交 Gemfile.lock 以减少不同机器的依赖差异。"
  };
}

async function diagnoseDotnetDependencyState(
  command: Command,
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  const hasDotnetProject =
    (await directoryHasFileEnding(command.cwd, ".csproj", fileExistsFn)) ||
    (await directoryHasFileEnding(command.cwd, ".sln", fileExistsFn));
  if (!hasDotnetProject) return undefined;
  if (await fileExistsFn(path.join(command.cwd, "obj", "project.assets.json"))) return undefined;

  return {
    summary: ".NET restore 产物未发现。",
    detail: "检测到 .NET 项目，但没有 obj/project.assets.json。首次运行前建议执行：dotnet restore；否则运行时可能需要联网恢复 NuGet 包。"
  };
}
