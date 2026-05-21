import path from "node:path";
import type { FileSystemAdapter } from "../../adapters.js";
import type { Command } from "../../types.js";
import { command, resolveProjectExecutable } from "./common.js";

export async function detectJavaCommands(projectPath: string, markers: string[], fs: FileSystemAdapter): Promise<Command[]> {
  const commands: Command[] = [];
  const hasMaven = markers.includes("pom.xml") || markers.includes("mvnw") || markers.includes("mvnw.cmd");
  const hasGradle = markers.some((marker) => ["build.gradle", "build.gradle.kts", "settings.gradle", "settings.gradle.kts", "gradlew", "gradlew.bat"].includes(marker));

  if (hasMaven) {
    const mvn = await resolveProjectExecutable(projectPath, fs, ["mvnw.cmd", "mvnw"], "mvn");
    if (await isSpringBootMavenProject(projectPath, fs)) {
      commands.push(command("java-maven-spring-boot-run", "Spring Boot run", mvn, ["spring-boot:run"], projectPath, "detected", "dev"));
    }
    commands.push(command("java-maven-test", "Maven test", mvn, ["test"], projectPath, "detected", "test"));
    commands.push(command("java-maven-package", "Maven package", mvn, ["package"], projectPath, "detected", "build"));
  }

  if (hasGradle) {
    const gradle = await resolveProjectExecutable(projectPath, fs, ["gradlew.bat", "gradlew"], "gradle");
    const springBoot = await isSpringBootGradleProject(projectPath, fs);
    commands.push(command(springBoot ? "java-gradle-boot-run" : "java-gradle-run", springBoot ? "Gradle bootRun" : "Gradle run", gradle, [springBoot ? "bootRun" : "run"], projectPath, "detected", "dev"));
    commands.push(command("java-gradle-test", "Gradle test", gradle, ["test"], projectPath, "detected", "test"));
    commands.push(command("java-gradle-build", "Gradle build", gradle, ["build"], projectPath, "detected", "build"));
  }

  return commands;
}

async function isSpringBootMavenProject(projectPath: string, fs: FileSystemAdapter): Promise<boolean> {
  try {
    const pom = await fs.readFile(path.join(projectPath, "pom.xml"));
    return /spring-boot/i.test(pom);
  } catch {
    return false;
  }
}

async function isSpringBootGradleProject(projectPath: string, fs: FileSystemAdapter): Promise<boolean> {
  for (const fileName of ["build.gradle", "build.gradle.kts"]) {
    try {
      const source = await fs.readFile(path.join(projectPath, fileName));
      if (/org\.springframework\.boot|spring-boot/i.test(source)) return true;
    } catch {
      // Keep scanning other Gradle files.
    }
  }
  return false;
}
