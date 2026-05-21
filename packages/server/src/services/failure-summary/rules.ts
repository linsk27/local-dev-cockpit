import { summarizeEcosystemFailure } from "./ecosystems.js";
import { summarizeNodeFailure } from "./node.js";
import { summarizePortConflictFailure } from "./port-conflict.js";
import { summarizePythonFailure } from "./python.js";
import type { FailureRule } from "./types.js";

export const knownFailureRules: FailureRule[] = [
  summarizePortConflictFailure,
  summarizePythonFailure,
  summarizeNodeFailure,
  summarizeEcosystemFailure
];
