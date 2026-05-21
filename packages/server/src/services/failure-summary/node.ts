import type { FailureRule } from "./types.js";
import { isLocalModuleReference, packageAddCommand, packageInstallCommand } from "./utils.js";

export const summarizeNodeFailure: FailureRule = ({ rawLog, exitCode, command }) => {
  const nodeMissingPackage = parseNodeMissingPackage(rawLog);
  if (nodeMissingPackage) {
    const installCommand = packageInstallCommand(command);
    const addCommand = packageAddCommand(command, nodeMissingPackage.name);
    return [
      nodeMissingPackage.kind === "dependency"
        ? `缺少 Node 依赖：${nodeMissingPackage.name}。`
        : `Node 无法找到本地文件或模块：${nodeMissingPackage.name}。`,
      nodeMissingPackage.kind === "dependency"
        ? `请先在项目目录运行：${installCommand}；如果依旧缺失，再运行：${addCommand}。`
        : "请检查源码路径、构建产物或 tsconfig/别名配置是否正确。",
      "如果终端能跑但 Dev Cockpit 不能跑，通常是项目依赖未安装到当前工作目录，或使用了不同的包管理器。",
      `(exit code ${exitCode ?? "unknown"})`
    ].join(" ");
  }

  const missingScriptBinary = parseMissingScriptBinary(rawLog);
  if (!missingScriptBinary) return undefined;
  return [
    `脚本命令缺失：${missingScriptBinary}。`,
    `这通常表示 node_modules 没安装，或 package.json 里的脚本依赖没有同步。请先在项目目录运行：${packageInstallCommand(command)}。`,
    "如果安装后仍失败，请确认该命令是否写在 devDependencies 中。",
    `(exit code ${exitCode ?? "unknown"})`
  ].join(" ");
};

function parseNodeMissingPackage(rawLog: string): { name: string; kind: "dependency" | "local-module" } | undefined {
  const match =
    rawLog.match(/Cannot find package ['"]([^'"]+)['"]/i) ??
    rawLog.match(/Cannot find module ['"]([^'"]+)['"]/i) ??
    rawLog.match(/Error \[ERR_MODULE_NOT_FOUND\]:\s*Cannot find package ['"]([^'"]+)['"]/i);
  const name = match?.[1]?.trim();
  if (!name) return undefined;
  const kind = isLocalModuleReference(name) ? "local-module" : "dependency";
  return { name, kind };
}

function parseMissingScriptBinary(rawLog: string): string | undefined {
  const match =
    rawLog.match(/['"]?([A-Za-z0-9._-]+)(?:\.cmd)?['"]?\s+is not recognized as an internal or external command/i) ??
    rawLog.match(/(?:sh:\s*)?([A-Za-z0-9._-]+):\s*command not found/i) ??
    rawLog.match(/spawn\s+([A-Za-z0-9._-]+)\s+ENOENT/i);
  const binary = match?.[1]?.trim();
  if (!binary || ["node", "npm", "pnpm", "yarn", "bun", "python", "python3", "py"].includes(binary.toLowerCase())) return undefined;
  return binary;
}
