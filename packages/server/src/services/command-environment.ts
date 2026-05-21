import type { Command } from "@local-dev-cockpit/core";
import { missingJavaRuntimeForBuildTool } from "./runtime/java.js";
import { packageManagerMissingMessage, runtimeMissingMessage } from "./runtime/messages.js";
import { diagnoseProjectDependencyState } from "./runtime/dependency-diagnostics.js";
import { resolvePackageManagerFallback, toNpmRunArgs } from "./runtime/node.js";
import {
  discoverPythonEnvironmentCandidates,
  parseCondaEnvironmentPaths,
  resolvePythonInvocation,
  validatePythonEnvironmentBinding,
  type PythonEnvironmentCandidate
} from "./runtime/python.js";
import {
  PACKAGE_MANAGER_COMMANDS,
  PYTHON_COMMANDS,
  VERIFIED_RUNTIME_COMMANDS,
  type CommandEnvironmentDiagnostic,
  type CommandResolutionOptions,
  type SpawnInvocation,
  createSpawnInvocation,
  defaultCommandExists,
  formatResolvedCommand,
  isCommandAvailable,
  isPackageManagerAvailable,
  isPathLikeCommand,
  normalizeExecutableName
} from "./runtime/shared.js";

export {
  discoverPythonEnvironmentCandidates,
  parseCondaEnvironmentPaths,
  toNpmRunArgs,
  validatePythonEnvironmentBinding
};
export type { CommandEnvironmentDiagnostic, CommandResolutionOptions, PythonEnvironmentCandidate, SpawnInvocation };

export async function resolveSpawnInvocation(command: Command, options: CommandResolutionOptions = {}): Promise<SpawnInvocation> {
  const platform = options.platform ?? process.platform;
  const commandName = command.command.trim();
  const lower = commandName.toLowerCase();
  const normalized = normalizeExecutableName(commandName);
  if (PYTHON_COMMANDS.has(lower)) {
    const pythonInvocation = await resolvePythonInvocation(command, lower, platform, options);
    if (pythonInvocation) return pythonInvocation;
  }
  if (!PACKAGE_MANAGER_COMMANDS.has(lower)) {
    const missingRuntime = await missingVerifiedRuntimeMessage(commandName, platform, options.commandExists);
    if (missingRuntime) throw new Error(missingRuntime);
    const missingJava = await missingJavaRuntimeForBuildTool(normalized, platform, options);
    if (missingJava) throw new Error(missingJava);
    return createSpawnInvocation(commandName, command.args, platform);
  }

  if (await isPackageManagerAvailable(lower, platform, options.commandExists)) {
    return createSpawnInvocation(commandName, command.args, platform);
  }

  const fallback = await resolvePackageManagerFallback(command, lower, platform, options);
  if (fallback) return fallback;

  throw new Error(packageManagerMissingMessage(lower));
}

export async function diagnoseCommandEnvironment(
  command: Command,
  options: CommandResolutionOptions = {}
): Promise<CommandEnvironmentDiagnostic> {
  try {
    const platform = options.platform ?? process.platform;
    const invocation = await resolveSpawnInvocation(command, options);
    const preflight = await diagnoseProjectDependencyState(command, options);
    const verification = commandVerificationKind(command.command);
    if (preflight) {
      return {
        commandId: command.id,
        label: command.label,
        status: "warn",
        summary: preflight.summary,
        detail: `${preflight.detail} 解析命令：${formatResolvedCommand(invocation.command, invocation.args, platform)}`,
        resolvedCommand: formatResolvedCommand(invocation.command, invocation.args, platform)
      };
    }
    return {
      commandId: command.id,
      label: command.label,
      status: verification === "unverified" ? "warn" : "ready",
      summary:
        invocation.note ??
        (verification === "unverified" ? "命令未自动验证，请确认它在 PATH 中可用。" : "运行环境已识别。"),
      detail: formatResolvedCommand(invocation.command, invocation.args, platform),
      resolvedCommand: formatResolvedCommand(invocation.command, invocation.args, platform)
    };
  } catch (error) {
    return {
      commandId: command.id,
      label: command.label,
      status: "missing",
      summary: "运行环境缺失。",
      detail: error instanceof Error ? error.message : String(error)
    };
  }
}

function commandVerificationKind(commandName: string): "verified" | "unverified" {
  const normalized = normalizeExecutableName(commandName);
  if (isPathLikeCommand(commandName)) return "verified";
  if (PYTHON_COMMANDS.has(normalized) || PACKAGE_MANAGER_COMMANDS.has(normalized) || VERIFIED_RUNTIME_COMMANDS.has(normalized)) return "verified";
  return "unverified";
}

async function missingVerifiedRuntimeMessage(
  commandName: string,
  platform: NodeJS.Platform,
  commandExists = defaultCommandExists
): Promise<string | undefined> {
  if (isPathLikeCommand(commandName)) return undefined;
  const normalized = normalizeExecutableName(commandName);
  if (!VERIFIED_RUNTIME_COMMANDS.has(normalized)) return undefined;
  if (await isCommandAvailable(normalized, platform, commandExists)) return undefined;
  return runtimeMissingMessage(normalized);
}
