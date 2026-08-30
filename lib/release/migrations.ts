export type MigrationPhase = "expand" | "migrate" | "contract";

export interface ExpandContractMigration {
  id: string;
  sourceField: string;
  targetField: string;
  phase: MigrationPhase;
  deprecatedReadsAllowed: boolean;
}

export function isFieldReadAllowed(
  migration: ExpandContractMigration,
  requestedField: string
): boolean {
  if (migration.phase === "expand" || migration.phase === "migrate") {
    // In expand and migrate phases, reading either old or new field is allowed
    return true;
  }
  if (migration.phase === "contract") {
    // In contract phase, deprecated field reads are strictly forbidden
    return requestedField !== migration.sourceField;
  }
  return true;
}

export function assertZeroReadsOfDeprecatedField(
  migration: ExpandContractMigration,
  readCount: number
): { safeToContract: boolean; reason: string } {
  if (readCount > 0) {
    return {
      safeToContract: false,
      reason: `Cannot enter contract phase: ${readCount} active reads recorded for deprecated field '${migration.sourceField}'`,
    };
  }
  return {
    safeToContract: true,
    reason: `Field '${migration.sourceField}' has zero reads. Safe to drop column/contract schema.`,
  };
}
