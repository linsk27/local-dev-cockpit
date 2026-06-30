import type { ProcessManager } from "../process-manager.js";
import type { ProjectScanCache } from "../services/project-scan-cache.js";
import type { SkillRadarStore } from "../services/skill-radar/index.js";
import type { JsonStore } from "../store.js";

export interface ServerRouteContext {
  store: JsonStore;
  processManager: ProcessManager;
  projectCache: ProjectScanCache;
  skillRadar: SkillRadarStore;
  currentVersion: string;
}
