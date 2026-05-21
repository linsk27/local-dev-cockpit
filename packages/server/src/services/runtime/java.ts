import path from "node:path";
import type { Command } from "@local-dev-cockpit/core";
import {
  JAVA_BUILD_COMMANDS,
  type CommandResolutionOptions,
  fileExists,
  hasAnyFile,
  isCommandAvailable,
  normalizeExecutableName
} from "./shared.js";

export async function diagnoseJavaDependencyState(
  command: Command,
  tool: "mvn" | "gradle",
  options: CommandResolutionOptions
): Promise<{ summary: string; detail: string } | undefined> {
  const fileExistsFn = options.fileExists ?? fileExists;
  const isMavenProject = await fileExistsFn(path.join(command.cwd, "pom.xml"));
  const isGradleProject =
    (await fileExistsFn(path.join(command.cwd, "build.gradle"))) ||
    (await fileExistsFn(path.join(command.cwd, "build.gradle.kts"))) ||
    (await fileExistsFn(path.join(command.cwd, "settings.gradle"))) ||
    (await fileExistsFn(path.join(command.cwd, "settings.gradle.kts")));
  if (tool === "mvn" && !isMavenProject) return undefined;
  if (tool === "gradle" && !isGradleProject) return undefined;

  if (tool === "mvn" && !(await hasAnyFile(command.cwd, ["mvnw", "mvnw.cmd"], fileExistsFn))) {
    return {
      summary: "Java 项目未提交 Maven wrapper。",
      detail: "当前会使用系统 Maven。为了让其他机器更容易运行，建议项目提交 mvnw / mvnw.cmd；否则需要用户本机已安装 Maven。"
    };
  }

  if (tool === "gradle" && !(await hasAnyFile(command.cwd, ["gradlew", "gradlew.bat"], fileExistsFn))) {
    return {
      summary: "Java 项目未提交 Gradle wrapper。",
      detail: "当前会使用系统 Gradle。为了让其他机器更容易运行，建议项目提交 gradlew / gradlew.bat；否则需要用户本机已安装 Gradle。"
    };
  }

  return undefined;
}

export async function missingJavaRuntimeForBuildTool(
  normalizedCommand: string,
  platform: NodeJS.Platform,
  options: CommandResolutionOptions
): Promise<string | undefined> {
  if (!JAVA_BUILD_COMMANDS.has(normalizedCommand)) return undefined;
  if (await isJavaRuntimeAvailable(platform, options)) return undefined;
  return "Java/JDK 不可用。Maven/Gradle 项目需要 Java。请安装 JDK，并配置 JAVA_HOME 或把 java 加入 PATH。";
}

async function isJavaRuntimeAvailable(platform: NodeJS.Platform, options: CommandResolutionOptions): Promise<boolean> {
  if (await isCommandAvailable("java", platform, options.commandExists)) return true;

  const env = options.env ?? process.env;
  const javaHome = env.JAVA_HOME?.trim();
  if (!javaHome) return false;

  const javaExecutable = platform === "win32" ? "java.exe" : "java";
  const fileExistsFn = options.fileExists ?? fileExists;
  return fileExistsFn(path.join(javaHome, "bin", javaExecutable));
}

export function javaBuildToolFromCommand(normalizedCommand: string): "mvn" | "gradle" | undefined {
  if (normalizedCommand === "mvn" || normalizedCommand === "mvnw") return "mvn";
  if (normalizedCommand === "gradle" || normalizedCommand === "gradlew") return "gradle";
  return undefined;
}
