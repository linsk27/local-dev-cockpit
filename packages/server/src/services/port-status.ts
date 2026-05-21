import { NodeProcessAdapter, type ErrorSummary, type ProcessRun, type Project } from "@local-dev-cockpit/core";
import type { ProcessManager } from "../process-manager.js";
import { extractPortsFromLogs, logIndicatesExistingServer, parseLocalEndpointsFromLogs } from "./port-status/port-logs.js";
import {
  assignExternalPortOwners,
  countDetectedPortOwners,
  EXTERNAL_PORT_OWNER_CACHE_TTL_MS,
  getCachedExternalPortOwners,
  invalidateExternalPortOwnersCache,
  mapExternalPortClaims,
  parseExternalPortOwners,
  commandLineReferencesProject,
  type ExternalPortOwner
} from "./port-status/port-owners.js";
import {
  externalListenerProbeCandidates,
  isLocalHttpEndpointReachable
} from "./port-status/port-probes.js";
import {
  filterStaleLogPorts,
  findExternalProjectPorts,
  mergePorts,
  normalizeScannedPorts
} from "./port-status/port-normalizer.js";
import {
  hydrateLastRun,
  isObsoleteMissingToolFailure,
  isStaleError,
  normalizeManagedRun,
  parseMissingToolName
} from "./port-status/run-state.js";

export async function enrichProject(
  project: Project,
  lastRun: ProcessRun | undefined,
  lastError: ErrorSummary | undefined,
  processManager: ProcessManager,
  enrichment: EnrichmentContext
): Promise<Project> {
  const managedRun = normalizeManagedRun(lastRun, processManager);
  const logPorts = managedRun
    ? await extractPortsFromLogs(await processManager.readLogs(managedRun.id), managedRun.status, project.path)
    : [];
  const externalPorts = await findExternalProjectPorts(project, enrichment.externalPortOwnersByProject.get(project.id) ?? [], logPorts);
  const processPorts = filterStaleLogPorts(project.id, managedRun, logPorts, externalPorts, enrichment.externalPortClaims);
  const scannedPorts = await normalizeScannedPorts(project, externalPorts, enrichment.detectedPortCounts);
  const hydratedRun = hydrateLastRun(managedRun, processPorts);
  const obsoleteToolFailure = isObsoleteMissingToolFailure(project, hydratedRun, lastError);
  const currentRun = obsoleteToolFailure ? undefined : hydratedRun;
  const currentError = obsoleteToolFailure || isStaleError(currentRun, lastError) ? undefined : lastError;

  return {
    ...project,
    ports: mergePorts([...scannedPorts, ...externalPorts], processPorts),
    lastRun: currentRun,
    lastError: currentError
  };
}

export interface EnrichmentContext {
  externalPortOwnersByProject: Map<string, ExternalPortOwner[]>;
  externalPortClaims: Map<number, Set<string>>;
  detectedPortCounts: Map<number, number>;
}

export async function createEnrichmentContext(projects: Project[]): Promise<EnrichmentContext> {
  const externalPortOwners = await getCachedExternalPortOwners(new NodeProcessAdapter());
  const externalPortOwnersByProject = assignExternalPortOwners(projects, externalPortOwners);
  return {
    externalPortOwnersByProject,
    externalPortClaims: mapExternalPortClaims(externalPortOwnersByProject),
    detectedPortCounts: countDetectedPortOwners(projects)
  };
}

export {
  assignExternalPortOwners,
  commandLineReferencesProject,
  EXTERNAL_PORT_OWNER_CACHE_TTL_MS,
  externalListenerProbeCandidates,
  filterStaleLogPorts,
  findExternalProjectPorts,
  invalidateExternalPortOwnersCache,
  isLocalHttpEndpointReachable,
  isObsoleteMissingToolFailure,
  logIndicatesExistingServer,
  normalizeScannedPorts,
  parseExternalPortOwners,
  parseLocalEndpointsFromLogs,
  parseMissingToolName
};

export type { ExternalPortOwner };
