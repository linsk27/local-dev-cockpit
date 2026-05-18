import os from "node:os";
import path from "node:path";

export interface AppPaths {
  dataDir: string;
  configPath: string;
  statePath: string;
  logsDir: string;
}

export function resolveAppPaths(): AppPaths {
  const base =
    process.env.LOCAL_DEV_COCKPIT_HOME ??
    (process.platform === "win32"
      ? path.join(process.env.APPDATA ?? os.homedir(), "local-dev-cockpit")
      : path.join(os.homedir(), ".local-dev-cockpit"));

  return {
    dataDir: base,
    configPath: path.join(base, "config.json"),
    statePath: path.join(base, "state.json"),
    logsDir: path.join(base, "logs")
  };
}

