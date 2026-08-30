#!/usr/bin/env tsx
/**
 * Audit Migration CLI
 *
 * Usage:
 *   npm run audit:migrate
 *   npm run audit:migrate -- --status
 */

import { getMigrationStatus, migrateLegacyAuditLogs } from "@/lib/security/audit-migration"

async function main() {
  const args = process.argv.slice(2)
  const checkStatus = args.includes("--status")

  if (checkStatus) {
    const status = await getMigrationStatus()

    console.log("Migration Status:")
    console.log(`  Legacy Audit Logs: ${status.legacyLogsCount}`)
    console.log(`  Migrated Logs: ${status.migratedLogsCount}`)
    console.log(`  Migration Complete: ${status.migrationComplete ? "YES" : "NO"}`)
    console.log(`  Legacy Partition: ${status.legacyPartition}`)
    process.exit(0)
  }

  const result = await migrateLegacyAuditLogs()

  console.log("Migration Result:")
  console.log(`  Success: ${result.success ? "YES" : "NO"}`)
  console.log(`  Migrated: ${result.migratedCount}`)
  console.log(`  Skipped: ${result.skippedCount}`)
  console.log(`  Legacy Partition: ${result.legacyPartition}`)

  if (result.errors.length > 0) {
    console.log(`Errors (${result.errors.length}):`)
    for (const error of result.errors.slice(0, 10)) {
      console.log(`  ${error}`)
    }
    if (result.errors.length > 10) {
      console.log(`  ... and ${result.errors.length - 10} more`)
    }
  }

  if (!result.success) {
    process.exit(1)
  }

  console.log("OK Migration completed. Verify with:")
  console.log(`  npm run audit:verify -- --partition=${result.legacyPartition}`)
}

main().catch((error) => {
  console.error("Migration failed:", error)
  process.exit(1)
})
