import type { Command } from "../../types.js";
import { command } from "./common.js";

export function detectGoCommands(projectPath: string, markers: string[]): Command[] {
  return markers.includes("go.mod") ? [command("go-run", "Go run", "go", ["run", "."], projectPath, "detected", "dev")] : [];
}

export function detectRustCommands(projectPath: string, markers: string[]): Command[] {
  return markers.includes("Cargo.toml") ? [command("cargo-run", "Cargo run", "cargo", ["run"], projectPath, "detected", "dev")] : [];
}

export function detectDockerCommands(projectPath: string, markers: string[]): Command[] {
  return markers.includes("docker-compose.yml") || markers.includes("compose.yml")
    ? [command("docker-compose-up", "Docker compose up", "docker", ["compose", "up"], projectPath, "detected", "start")]
    : [];
}
