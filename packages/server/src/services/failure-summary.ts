import type { Command } from "@local-dev-cockpit/core";
import { stripAnsiControlSequences } from "../log-decoder.js";
import { summarizeFallbackFailure } from "./failure-summary/fallback.js";
import { knownFailureRules } from "./failure-summary/rules.js";

/**
 * Converts raw process output into short, actionable failure messages. Runtime
 * families live in small rule modules so new hints do not touch process
 * lifecycle code or grow this facade.
 */
export function summarizeFailedRun(buffer: string[], exitCode: number | null, command?: Command): string {
  const rawLog = stripAnsiControlSequences(buffer.join(""));
  for (const rule of knownFailureRules) {
    const summary = rule({ rawLog, exitCode, command });
    if (summary) return summary;
  }
  return summarizeFallbackFailure(rawLog, exitCode);
}
