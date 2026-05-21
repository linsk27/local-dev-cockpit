export function packageManagerMissingMessage(packageManager: string): string {
  const installHint =
    packageManager === "yarn"
      ? "请安装 Yarn，或启用 corepack，或保留 package-lock.json 后改用 npm。"
      : packageManager === "pnpm"
        ? "请安装 pnpm，或启用 corepack。"
        : packageManager === "bun"
          ? "请安装 Bun，或改用 npm/pnpm/yarn 脚本。"
          : `请确认 ${packageManager} 已加入 PATH。`;
  return `${packageManager} 未安装或不在 PATH 中。${installHint}`;
}

export function runtimeMissingMessage(commandName: string): string {
  const hints: Record<string, string> = {
    bundle: "Ruby 项目通常需要先安装 Ruby、Bundler，并在项目中执行 bundle install。",
    composer: "PHP 项目通常需要先安装 PHP、Composer，并在项目中执行 composer install。",
    docker: "Docker 命令不可用。请确认 Docker Desktop 已安装并启动。",
    dotnet: ".NET SDK 不可用。请安装 .NET SDK 后再运行。",
    go: "Go 命令不可用。请安装 Go 并加入 PATH。",
    gradle: "Gradle 不可用。建议优先提交 gradlew/gradlew.bat wrapper，或安装 Gradle。",
    mvn: "Maven 不可用。建议优先提交 mvnw/mvnw.cmd wrapper，或安装 Maven。",
    php: "PHP 命令不可用。请安装 PHP 并加入 PATH。",
    ruby: "Ruby 命令不可用。请安装 Ruby 并加入 PATH。",
    cargo: "Cargo 不可用。请安装 Rust 工具链。"
  };
  return `${commandName} 未安装或不在 PATH 中。${hints[commandName] ?? "请安装对应运行时后再运行。"}`;
}
