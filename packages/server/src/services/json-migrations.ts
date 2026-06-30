export interface JsonMigration {
  fromVersion: number;
  toVersion: number;
  migrate(value: unknown): unknown;
}

export function migrateVersionedJson(value: unknown, latestVersion: number, migrations: JsonMigration[] = []): unknown {
  if (!Number.isInteger(latestVersion) || latestVersion < 1) {
    throw new Error("latestVersion must be a positive integer");
  }

  let currentValue = value;
  let currentVersion = jsonVersion(currentValue);
  if (currentVersion === 0 && migrations.length === 0) {
    return withJsonVersion(currentValue, latestVersion);
  }

  const ordered = [...migrations].sort((left, right) => left.fromVersion - right.fromVersion || left.toVersion - right.toVersion);
  while (currentVersion < latestVersion) {
    const migration = ordered.find((candidate) => candidate.fromVersion === currentVersion);
    if (!migration) {
      throw new Error(`Missing JSON migration from version ${currentVersion} to ${latestVersion}`);
    }
    currentValue = migration.migrate(currentValue);
    currentVersion = migration.toVersion;
    currentValue = withJsonVersion(currentValue, currentVersion);
  }

  if (currentVersion > latestVersion) {
    throw new Error(`Unsupported JSON version ${currentVersion}; latest supported version is ${latestVersion}`);
  }
  return withJsonVersion(currentValue, latestVersion);
}

function jsonVersion(value: unknown): number {
  if (!isRecord(value)) return 0;
  const version = value.version;
  return typeof version === "number" && Number.isInteger(version) && version > 0 ? version : 0;
}

function withJsonVersion(value: unknown, version: number): unknown {
  return isRecord(value) ? { ...value, version } : { version };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
