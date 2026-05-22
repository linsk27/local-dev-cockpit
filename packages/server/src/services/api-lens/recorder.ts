import { randomUUID } from "node:crypto";
import type { ApiLensRequestRecord } from "./types.js";

const DEFAULT_LIMIT_PER_TARGET = 200;

export class ApiLensRecorder {
  private readonly recordsByTarget = new Map<string, ApiLensRequestRecord[]>();

  constructor(private readonly limitPerTarget = DEFAULT_LIMIT_PER_TARGET) {}

  createId(): string {
    return randomUUID();
  }

  record(record: ApiLensRequestRecord): void {
    const existing = this.recordsByTarget.get(record.targetId) ?? [];
    const next = [record, ...existing].slice(0, this.limitPerTarget);
    this.recordsByTarget.set(record.targetId, next);
  }

  list(options: { targetId?: string; limit?: number } = {}): ApiLensRequestRecord[] {
    const limit = Math.max(1, Math.min(options.limit ?? 100, this.limitPerTarget));
    if (options.targetId) return (this.recordsByTarget.get(options.targetId) ?? []).slice(0, limit);
    return [...this.recordsByTarget.values()]
      .flat()
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt))
      .slice(0, limit);
  }

  get(id: string): ApiLensRequestRecord | undefined {
    for (const records of this.recordsByTarget.values()) {
      const record = records.find((item) => item.id === id);
      if (record) return record;
    }
    return undefined;
  }

  clear(targetId?: string): void {
    if (targetId) {
      this.recordsByTarget.delete(targetId);
      return;
    }
    this.recordsByTarget.clear();
  }
}
