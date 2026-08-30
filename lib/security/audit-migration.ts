import dbConnect from "@/lib/dbConnect"
import AuditLog from "@/models/AuditLog"
import TamperEvidentAuditLog from "@/models/TamperEvidentAuditLog"
import { getCurrentPartition } from "./tamper-evident-audit"
import { getGenesisHash, canonicalizeEventData, computeEventHash } from "./audit-hash"

export interface MigrationResult {
  success: boolean
  migratedCount: number
  skippedCount: number
  errors: string[]
  legacyPartition: string
}

/**
 * Migrate existing audit logs to tamper-evident system as legacy events
 */
export async function migrateLegacyAuditLogs(): Promise<MigrationResult> {
  const errors: string[] = []
  let migratedCount = 0
  let skippedCount = 0

  try {
    await dbConnect()

    const legacyPartition = "legacy-" + getCurrentPartition()

    // Get all existing audit logs
    const legacyLogs = await AuditLog.find({}).sort({ createdAt: 1 }).lean()

    if (legacyLogs.length === 0) {
      return {
        success: true,
        migratedCount: 0,
        skippedCount: 0,
        errors: [],
        legacyPartition,
      }
    }

    let sequence = 0
    let previousHash = getGenesisHash(legacyPartition)

    for (const legacyLog of legacyLogs) {
      try {
        // Check if already migrated
        const existing = await TamperEvidentAuditLog.findOne({
          partition: legacyPartition,
          sequence,
          isLegacy: true,
        })

        if (existing) {
          skippedCount++
          sequence++
          previousHash = existing.eventHash
          continue
        }

        // Build canonical event data for legacy event
        const eventData = {
          sequence,
          eventId: legacyLog._id.toString(),
          actorId: legacyLog.actorId?.toString(),
          actorRole: legacyLog.actorRole,
          action: legacyLog.action,
          targetType: legacyLog.targetType,
          targetId: legacyLog.targetId,
          status: legacyLog.status,
          metadata: legacyLog.metadata,
          ipAddress: legacyLog.ipAddress,
          timestamp: legacyLog.createdAt.toISOString(),
          partition: legacyPartition,
          previousHash,
          isLegacy: true,
        }

        const canonicalData = canonicalizeEventData(eventData)
        const eventHash = computeEventHash(previousHash + canonicalData)

        // Create tamper-evident audit log entry
        await TamperEvidentAuditLog.create({
          sequence,
          eventId: legacyLog._id.toString(),
          actorId: legacyLog.actorId?.toString(),
          actorRole: legacyLog.actorRole,
          action: legacyLog.action,
          targetType: legacyLog.targetType,
          targetId: legacyLog.targetId,
          status: legacyLog.status,
          metadata: legacyLog.metadata,
          ipAddress: legacyLog.ipAddress,
          timestamp: legacyLog.createdAt,
          previousHash,
          eventHash,
          canonicalData,
          partition: legacyPartition,
          isLegacy: true,
        })

        previousHash = eventHash
        sequence++
        migratedCount++
      } catch (error) {
        errors.push(
          `Failed to migrate event ${legacyLog._id}: ${error instanceof Error ? error.message : "Unknown error"}`,
        )
      }
    }

    return {
      success: errors.length === 0,
      migratedCount,
      skippedCount,
      errors,
      legacyPartition,
    }
  } catch (error) {
    errors.push(`Migration failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    return {
      success: false,
      migratedCount,
      skippedCount,
      errors,
      legacyPartition: "legacy-unknown",
    }
  }
}

/**
 * Get migration status
 */
export async function getMigrationStatus(): Promise<{
  legacyLogsCount: number
  migratedLogsCount: number
  migrationComplete: boolean
  legacyPartition: string
}> {
  await dbConnect()

  const legacyLogsCount = await AuditLog.countDocuments({})
  const legacyPartition = "legacy-" + getCurrentPartition()
  const migratedLogsCount = await TamperEvidentAuditLog.countDocuments({
    partition: legacyPartition,
    isLegacy: true,
  })

  return {
    legacyLogsCount,
    migratedLogsCount,
    migrationComplete: legacyLogsCount === migratedLogsCount,
    legacyPartition,
  }
}

/**
 * Clean up old audit logs after successful migration
 * WARNING: This should only be run after verifying migration success
 */
export async function cleanupOldAuditLogs(confirmationToken: string): Promise<{
  success: boolean
  deletedCount: number
  error?: string
}> {
  if (confirmationToken !== "CONFIRM_DELETE_OLD_AUDIT_LOGS") {
    return {
      success: false,
      deletedCount: 0,
      error: "Invalid confirmation token",
    }
  }

  try {
    await dbConnect()

    const migrationStatus = await getMigrationStatus()
    if (!migrationStatus.migrationComplete) {
      return {
        success: false,
        deletedCount: 0,
        error: "Migration not complete. Cannot delete old logs.",
      }
    }

    const result = await AuditLog.deleteMany({})

    return {
      success: true,
      deletedCount: result.deletedCount || 0,
    }
  } catch (error) {
    return {
      success: false,
      deletedCount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}
