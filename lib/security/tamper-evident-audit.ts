import { randomUUID } from "crypto"
import dbConnect from "@/lib/dbConnect"
import AuditSequence from "@/models/AuditSequence"
import TamperEvidentAuditLog from "@/models/TamperEvidentAuditLog"
import {
  buildCanonicalAuditEventData,
  canonicalizeEventData,
  computeEventHash,
  getGenesisHash,
  sanitizeAuditMetadata,
} from "./audit-hash"
import { autoCheckpointIfNeeded } from "./audit-checkpoint"

type AuditActor = {
  _id?: { toString(): string }
  role?: string
  email?: string
  walletAddress?: string
} | null

export interface TamperEvidentAuditEventInput {
  actor?: AuditActor
  action: string
  targetType: string
  targetId?: string | null
  status?: "success" | "failure"
  requestId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
  partition?: string
  criticalAction?: boolean // If true, throw error on audit failure
}

/**
 * Get the current partition identifier (monthly by default)
 */
export function getCurrentPartition(): string {
  const now = new Date()
  const year = now.getFullYear()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  return `${year}-${month}`
}

/**
 * Get the next sequence number for a partition
 */
async function reserveNextSequence(partition: string): Promise<number> {
  const counter = await AuditSequence.findOneAndUpdate(
    { partition },
    { $inc: { nextSequence: 1 }, $setOnInsert: { partition } },
    { new: false, upsert: true, setDefaultsOnInsert: true },
  )

  if (!counter) return 0
  return counter.nextSequence
}

/**
 * Get the previous event hash for chain linking
 */
async function getPreviousHash(partition: string, sequence: number): Promise<string> {
  if (sequence === 0) return getGenesisHash(partition)

  const predecessorSequence = sequence - 1
  for (let attempt = 0; attempt < 25; attempt++) {
    const previousEvent = await TamperEvidentAuditLog.findOne({
      partition,
      sequence: predecessorSequence,
    }).select("eventHash")

    if (previousEvent?.eventHash) return previousEvent.eventHash
    await new Promise((resolve) => setTimeout(resolve, 40))
  }

  throw new Error(`AUDIT_PREDECESSOR_MISSING: missing sequence ${predecessorSequence} in ${partition}`)
}

/**
 * Log a tamper-evident audit event
 */
export async function logTamperEvidentAuditEvent(input: TamperEvidentAuditEventInput): Promise<{
  success: boolean
  eventId?: string
  error?: string
}> {
  try {
    await dbConnect()

    const partition = input.partition || getCurrentPartition()
    const sequence = await reserveNextSequence(partition)
    const previousHash = await getPreviousHash(partition, sequence)
    const timestamp = new Date()
    const eventId = randomUUID()

    // Extract actor information
    const actorId = input.actor?._id?.toString()
    const actorRole =
      input.actor?.role === "admin" ||
      input.actor?.role === "driver" ||
      input.actor?.role === "investor" ||
      input.actor?.role === "system"
        ? input.actor.role
        : undefined

    const actorIdentifier = input.actor?.email || input.actor?.walletAddress

    // Sanitize metadata
    const sanitizedMetadata = sanitizeAuditMetadata(input.metadata)

    // Build canonical event data
    const eventData = buildCanonicalAuditEventData({
      sequence,
      eventId,
      actorId,
      actorRole,
      actorIdentifier,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId || undefined,
      status: input.status || "success",
      requestId: input.requestId || undefined,
      metadata: sanitizedMetadata,
      ipAddress: input.ipAddress || undefined,
      userAgent: input.userAgent || undefined,
      timestamp: timestamp.toISOString(),
      partition,
      previousHash,
    })

    // Canonicalize and hash
    const canonicalData = canonicalizeEventData(eventData)
    const eventHash = computeEventHash(previousHash + canonicalData)

    // Create the audit log entry
    const auditLog = await TamperEvidentAuditLog.create({
      sequence,
      eventId,
      actorId,
      actorRole,
      actorIdentifier,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId || undefined,
      status: input.status || "success",
      requestId: input.requestId || undefined,
      metadata: sanitizedMetadata,
      ipAddress: input.ipAddress || undefined,
      userAgent: input.userAgent || undefined,
      timestamp,
      previousHash,
      eventHash,
      canonicalData,
      partition,
      isLegacy: false,
    })

    // Auto-checkpoint if needed (every 1000 events)
    await autoCheckpointIfNeeded(partition, 1000)

    return {
      success: true,
      eventId: auditLog.eventId,
    }
  } catch (error) {
    console.error("TAMPER_EVIDENT_AUDIT_ERROR", error)

    // If this is a critical action, throw the error
    if (input.criticalAction) {
      throw new Error(
        `CRITICAL_AUDIT_FAILURE: ${error instanceof Error ? error.message : "Unknown error"}`,
      )
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * Batch log multiple audit events (for migration or bulk operations)
 */
export async function logTamperEvidentAuditEventBatch(
  events: TamperEvidentAuditEventInput[],
): Promise<{
  success: boolean
  eventIds: string[]
  errors: string[]
}> {
  const eventIds: string[] = []
  const errors: string[] = []

  for (const event of events) {
    const result = await logTamperEvidentAuditEvent(event)
    if (result.success && result.eventId) {
      eventIds.push(result.eventId)
    } else if (result.error) {
      errors.push(result.error)
    }
  }

  return {
    success: errors.length === 0,
    eventIds,
    errors,
  }
}

/**
 * Get audit events for a partition
 */
export async function getAuditEvents(partition: string, options?: {
  startSequence?: number
  endSequence?: number
  limit?: number
  includeLegacy?: boolean
}): Promise<any[]> {
  await dbConnect()

  const query: any = { partition }

  if (options?.startSequence !== undefined || options?.endSequence !== undefined) {
    query.sequence = {}
    if (options.startSequence !== undefined) {
      query.sequence.$gte = options.startSequence
    }
    if (options.endSequence !== undefined) {
      query.sequence.$lte = options.endSequence
    }
  }

  if (!options?.includeLegacy) {
    query.isLegacy = false
  }

  let queryBuilder = TamperEvidentAuditLog.find(query).sort({ sequence: 1 })

  if (options?.limit) {
    queryBuilder = queryBuilder.limit(options.limit)
  }

  return await queryBuilder.lean()
}

/**
 * Search audit events by criteria
 */
export async function searchAuditEvents(criteria: {
  partition?: string
  action?: string
  actorId?: string
  targetType?: string
  targetId?: string
  status?: "success" | "failure"
  startDate?: Date
  endDate?: Date
  limit?: number
}): Promise<any[]> {
  await dbConnect()

  const query: any = {}

  if (criteria.partition) query.partition = criteria.partition
  if (criteria.action) query.action = criteria.action
  if (criteria.actorId) query.actorId = criteria.actorId
  if (criteria.targetType) query.targetType = criteria.targetType
  if (criteria.targetId) query.targetId = criteria.targetId
  if (criteria.status) query.status = criteria.status

  if (criteria.startDate || criteria.endDate) {
    query.timestamp = {}
    if (criteria.startDate) query.timestamp.$gte = criteria.startDate
    if (criteria.endDate) query.timestamp.$lte = criteria.endDate
  }

  query.isLegacy = false

  let queryBuilder = TamperEvidentAuditLog.find(query).sort({ timestamp: -1 })

  if (criteria.limit) {
    queryBuilder = queryBuilder.limit(criteria.limit)
  }

  return await queryBuilder.lean()
}
