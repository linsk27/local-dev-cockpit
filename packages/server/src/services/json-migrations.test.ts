import { describe, expect, it } from "vitest";
import { migrateVersionedJson } from "./json-migrations.js";

describe("json-migrations", () => {
  it("adds the current version to unversioned objects when no migration is needed", () => {
    expect(migrateVersionedJson({ items: [] }, 1)).toEqual({ version: 1, items: [] });
  });

  it("runs migrations in version order", () => {
    expect(
      migrateVersionedJson({ name: "demo" }, 2, [
        {
          fromVersion: 0,
          toVersion: 1,
          migrate: (value) => ({ ...(value as Record<string, unknown>), items: [] })
        },
        {
          fromVersion: 1,
          toVersion: 2,
          migrate: (value) => ({ ...(value as Record<string, unknown>), migrated: true })
        }
      ])
    ).toEqual({ version: 2, name: "demo", items: [], migrated: true });
  });

  it("fails clearly when a migration path is missing", () => {
    expect(() => migrateVersionedJson({ version: 1 }, 3)).toThrow("Missing JSON migration");
  });
});
