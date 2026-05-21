import type { FailureRule } from "./types.js";

export const summarizeEcosystemFailure: FailureRule = ({ rawLog, exitCode }) => {
  if (isPhpComposerAutoloadFailure(rawLog)) {
    return [
      "PHP 依赖尚未安装或未同步：缺少 vendor/autoload.php。",
      "请在项目目录运行：composer install。",
      "如果已经安装过依赖，请确认当前命令的工作目录是包含 composer.json 的项目根目录。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  if (isRubyBundleFailure(rawLog)) {
    return [
      "Ruby 依赖尚未安装或未同步。",
      "请在项目目录运行：bundle install。",
      "如果使用 rbenv、rvm 或 asdf，请确认 Dev Cockpit 启动时继承到了正确的 Ruby 环境。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  if (isDotnetRestoreFailure(rawLog)) {
    return [
      ".NET restore 产物缺失。",
      "请在项目目录运行：dotnet restore，然后再启动项目。",
      "如果项目在私有 NuGet 源中，请先确认本机 NuGet 凭据可用。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  return undefined;
};

function isPhpComposerAutoloadFailure(rawLog: string): boolean {
  return /vendor[\\/]+autoload\.php/i.test(rawLog) || /Failed opening required ['"][^'"]*autoload\.php['"]/i.test(rawLog);
}

function isRubyBundleFailure(rawLog: string): boolean {
  return /Could not find gem ['"][^'"]+['"]/i.test(rawLog) || /Run `bundle install` to install missing gems/i.test(rawLog);
}

function isDotnetRestoreFailure(rawLog: string): boolean {
  return /NETSDK1004/i.test(rawLog) || /project\.assets\.json/i.test(rawLog);
}
