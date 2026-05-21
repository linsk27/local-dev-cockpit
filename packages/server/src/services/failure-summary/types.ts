import type { Command } from "@local-dev-cockpit/core";

export interface FailureContext {
  rawLog: string;
  exitCode: number | null;
  command?: Command;
}

export type FailureRule = (context: FailureContext) => string | undefined;
