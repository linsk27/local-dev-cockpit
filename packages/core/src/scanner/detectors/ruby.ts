import type { Command } from "../../types.js";
import { command } from "./common.js";

export function detectRubyCommands(projectPath: string, markers: string[]): Command[] {
  const commands: Command[] = [];
  if (markers.includes("bin/rails")) {
    commands.push(command("ruby-rails-server", "Rails server", "bundle", ["exec", "rails", "server", "-b", "127.0.0.1", "-p", "3000"], projectPath, "detected", "dev"));
  } else if (markers.includes("config.ru")) {
    commands.push(command("ruby-rackup", "Rack server", "bundle", ["exec", "rackup", "-o", "127.0.0.1", "-p", "9292"], projectPath, "detected", "dev"));
  } else if (markers.includes("app.rb")) {
    commands.push(command("ruby-app", "Ruby app.rb", "bundle", ["exec", "ruby", "app.rb"], projectPath, "detected", "dev"));
  }
  if (markers.includes("Gemfile")) {
    commands.push(command("ruby-bundle-test", "Bundle test", "bundle", ["exec", "rake", "test"], projectPath, "detected", "test"));
  }
  return commands;
}
