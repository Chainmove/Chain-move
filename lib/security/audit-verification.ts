import dbConnect from "@/lib/dbConnect"
import TamperEvidentAuditLog from "@/models/TamperEvidentAuditLog"
import AuditCheckpoint from "@/models/AuditCheckpoint"
import { buildCanonicalAuditEventData, canonicalizeEventData, computeEventHash, computeRootHash, getGenesisHash } from "./audit-hash"
import { localSigner } from "./audit-checkpoint"

export interface VerificationResult {
  valid: boolean
  errors: VerificationError[]
  warnings: VerificationWarning[]
  summary: {
    totalEvents: number
    eventsVerified: number
    firstSequence: number
    lastSequence: number
    partition: string
    checkpointsVerified?: number
  }
}

export interface VerificationError {
  type:
    | "BROKEN_CHAIN"
    | "MISSING_SEQUENCE"
    | "INVALID_HASH"
    | "MALFORMED_EVENT"
    | "INVALID_CHECKPOINT"
    | "CHECKPOINT_SIGNATURE_INVALID"
  sequence?: number
  eventId?: string
  message: string
  details?: any
}

export interface VerificationWarning {
  type: "LEGACY_EVENTS" | "MISSING_CHECKPOINT" | "OLD_CHECKPOINT"
  message: string
  details?: any
}

export interface AuditExportPayload {
  manifest?: {
    partition?: string
    startSequence?: number
    endSequence?: number
    startEventHash?: string
    endEventHash?: string
  }
  events?: any[]
  checkpoints?: any[]
}

/**
 * Verify the integrity of the audit chain for a partition
 */
export async function verifyAuditChain(partition: string, options?: {
  startSequence?: number
  endSequence?: number
  verifyCheckpoints?: boolean
}): Promise<VerificationResult> {
  const errors: VerificationError[] = []
  const warnings: VerificationWarning[] = []

  try {
    await dbConnect()

    // Get all events in the partition
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

    const events = await TamperEvidentAuditLog.find(query).sort({ sequence: 1 }).lean()

    if (events.length === 0) {
      return {
        valid: true,
        errors: [],
        warnings: [],
        summary: {
          totalEvents: 0,
          eventsVerified: 0,
          firstSequence: 0,
          lastSequence: 0,
          partition,
        },
      }
    }

    // Check for legacy events
    const legacyEvents = events.filter((e) => e.isLegacy)
    if (legacyEvents.length > 0) {
      warnings.push({
        type: "LEGACY_EVENTS",
        message: `Found ${legacyEvents.length} legacy events that cannot be verified`,
        details: { count: legacyEvents.length },
      })
    }

    // Verify non-legacy events
    const verifiableEvents = events.filter((e) => !e.isLegacy)
    let expectedPreviousHash = getGenesisHash(partition)
    if (verifiableEvents[0]?.sequence > 0) {
      const predecessor = await TamperEvidentAuditLog.findOne({
        partition,
        sequence: verifiableEvents[0].sequence - 1,
        isLegacy: false,
      }).lean()

      expectedPreviousHash = predecessor?.eventHash || verifiableEvents[0].previousHash
    }
    let eventsVerified = 0

    for (let i = 0; i < verifiableEvents.length; i++) {
      const event = verifiableEvents[i]
      const expectedSequence = i === 0 ? event.sequence : verifiableEvents[i - 1].sequence + 1

      // Check sequence continuity
      if (event.sequence !== expectedSequence && i > 0) {
        errors.push({
          type: "MISSING_SEQUENCE",
          sequence: expectedSequence,
          message: `Missing sequence number ${expectedSequence}. Expected ${expectedSequence}, got ${event.sequence}`,
          details: { expected: expectedSequence, actual: event.sequence },
        })
      }

      // Check previous hash matches
      if (event.previousHash !== expectedPreviousHash) {
        errors.push({
          type: "BROKEN_CHAIN",
          sequence: event.sequence,
          eventId: event.eventId,
          message: `Broken chain at sequence ${event.sequence}. Previous hash mismatch.`,
          details: {
            expected: expectedPreviousHash,
            actual: event.previousHash,
          },
        })
      }

      // Recompute event hash
      const canonicalData = canonicalizeEventData(buildCanonicalAuditEventData(event))
      if (event.canonicalData !== canonicalData) {
        errors.push({
          type: "INVALID_HASH",
          sequence: event.sequence,
          eventId: event.eventId,
          message: `Canonical data mismatch at sequence ${event.sequence}. Event fields may have been modified.`,
          details: {
            stored: event.canonicalData,
            computed: canonicalData,
          },
        })
      }

      const recomputedHash = computeEventHash(event.previousHash + canonicalData)
      if (event.eventHash !== recomputedHash) {
        errors.push({
          type: "INVALID_HASH",
          sequence: event.sequence,
          eventId: event.eventId,
          message: `Invalid hash at sequence ${event.sequence}. Event may have been modified.`,
          details: {
            stored: event.eventHash,
            computed: recomputedHash,
          },
        })
      }

      // Validate event structure
      if (!event.eventId || !event.action || !event.targetType || !event.timestamp) {
        errors.push({
          type: "MALFORMED_EVENT",
          sequence: event.sequence,
          eventId: event.eventId,
          message: `Malformed event at sequence ${event.sequence}. Missing required fields.`,
          details: {
            hasEventId: !!event.eventId,
            hasAction: !!event.action,
            hasTargetType: !!event.targetType,
            hasTimestamp: !!event.timestamp,
          },
        })
      }

      expectedPreviousHash = event.eventHash
      eventsVerified++
    }

    // Verify checkpoints if requested
    let checkpointsVerified = 0
    if (options?.verifyCheckpoints) {
      const checkpointResult = await verifyCheckpoints(partition)
      errors.push(...checkpointResult.errors)
      warnings.push(...checkpointResult.warnings)
      checkpointsVerified = checkpointResult.checkpointsVerified
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      summary: {
        totalEvents: events.length,
        eventsVerified,
        firstSequence: events[0].sequence,
        lastSequence: events[events.length - 1].sequence,
        partition,
        checkpointsVerified: options?.verifyCheckpoints ? checkpointsVerified : undefined,
      },
    }
  } catch (error) {
    console.error("VERIFICATION_ERROR", error)
    errors.push({
      type: "MALFORMED_EVENT",
      message: `Verification failed: ${error instanceof Error ? error.message : "Unknown error"}`,
    })

    return {
      valid: false,
      errors,
      warnings,
      summary: {
        totalEvents: 0,
        eventsVerified: 0,
        firstSequence: 0,
        lastSequence: 0,
        partition,
      },
    }
  }
}

/**
 * Verify checkpoint integrity
 */
async function verifyCheckpoints(partition: string): Promise<{
  errors: VerificationError[]
  warnings: VerificationWarning[]
  checkpointsVerified: number
}> {
  const errors: VerificationError[] = []
  const warnings: VerificationWarning[] = []
  let checkpointsVerified = 0

  const checkpoints = await AuditCheckpoint.find({ partition }).sort({ checkpointNumber: 1 })

  for (const checkpoint of checkpoints) {
    // Verify signature
    const signatureData = JSON.stringify({
      partition: checkpoint.partition,
      checkpointNumber: checkpoint.checkpointNumber,
      startSequence: checkpoint.startSequence,
      endSequence: checkpoint.endSequence,
      rootHash: checkpoint.rootHash,
    })

    const signatureValid = localSigner.verify(signatureData, checkpoint.signature)
    if (!signatureValid) {
      errors.push({
        type: "CHECKPOINT_SIGNATURE_INVALID",
        message: `Invalid checkpoint signature for checkpoint ${checkpoint.checkpointNumber}`,
        details: { checkpointNumber: checkpoint.checkpointNumber },
      })
      continue
    }

    // Verify root hash
    const events = await TamperEvidentAuditLog.find({
      partition,
      sequence: { $gte: checkpoint.startSequence, $lte: checkpoint.endSequence },
      isLegacy: false,
    }).sort({ sequence: 1 })

    const eventHashes = events.map((e) => e.eventHash)
    const computedRootHash = computeRootHash(eventHashes)

    if (checkpoint.rootHash !== computedRootHash) {
      errors.push({
        type: "INVALID_CHECKPOINT",
        message: `Invalid root hash for checkpoint ${checkpoint.checkpointNumber}`,
        details: {
          checkpointNumber: checkpoint.checkpointNumber,
          stored: checkpoint.rootHash,
          computed: computedRootHash,
        },
      })
      continue
    }

    // Check if checkpoint is old
    const daysSinceCheckpoint = (Date.now() - checkpoint.signedAt.getTime()) / (1000 * 60 * 60 * 24)
    if (daysSinceCheckpoint > 30) {
      warnings.push({
        type: "OLD_CHECKPOINT",
        message: `Checkpoint ${checkpoint.checkpointNumber} is ${Math.floor(daysSinceCheckpoint)} days old`,
        details: {
          checkpointNumber: checkpoint.checkpointNumber,
          daysSinceCheckpoint: Math.floor(daysSinceCheckpoint),
        },
      })
    }

    checkpointsVerified++
  }

  // Check if checkpoints exist
  if (checkpoints.length === 0) {
    const eventCount = await TamperEvidentAuditLog.countDocuments({ partition, isLegacy: false })
    if (eventCount > 1000) {
      warnings.push({
        type: "MISSING_CHECKPOINT",
        message: `Partition ${partition} has ${eventCount} events but no checkpoints`,
        details: { eventCount },
      })
    }
  }

  return { errors, warnings, checkpointsVerified }
}

/**
 * Verify a single event
 */
export async function verifySingleEvent(eventId: string): Promise<{
  valid: boolean
  errors: VerificationError[]
}> {
  await dbConnect()

  const errors: VerificationError[] = []
  const event = await TamperEvidentAuditLog.findOne({ eventId }).lean()

  if (!event) {
    errors.push({
      type: "MALFORMED_EVENT",
      eventId,
      message: "Event not found",
    })
    return { valid: false, errors }
  }

  if (event.isLegacy) {
    return { valid: true, errors: [] } // Legacy events cannot be verified
  }

  // Recompute hash
  const canonicalData = canonicalizeEventData(buildCanonicalAuditEventData(event))
  const recomputedHash = computeEventHash(event.previousHash + canonicalData)
  if (event.canonicalData !== canonicalData) {
    errors.push({
      type: "INVALID_HASH",
      eventId: event.eventId,
      sequence: event.sequence,
      message: "Canonical data mismatch - event fields may have been tampered with",
      details: {
        stored: event.canonicalData,
        computed: canonicalData,
      },
    })
  }

  if (event.eventHash !== recomputedHash) {
    errors.push({
      type: "INVALID_HASH",
      eventId: event.eventId,
      sequence: event.sequence,
      message: "Event hash mismatch - event may have been tampered with",
      details: {
        stored: event.eventHash,
        computed: recomputedHash,
      },
    })
  }

  return {
    valid: errors.length === 0,
    errors,
  }
}

export function verifyAuditExportPayload(payload: AuditExportPayload): VerificationResult {
  const errors: VerificationError[] = []
  const warnings: VerificationWarning[] = []
  const events = Array.isArray(payload.events) ? payload.events : []
  const partition = payload.manifest?.partition || events[0]?.partition || "unknown"

  if (!Array.isArray(payload.events)) {
    errors.push({
      type: "MALFORMED_EVENT",
      message: "Export payload is missing an events array",
    })
  }

  let expectedPreviousHash = events[0]?.previousHash || getGenesisHash(partition)
  let eventsVerified = 0

  for (let index = 0; index < events.length; index++) {
    const event = events[index]
    const expectedSequence = index === 0 ? event.sequence : events[index - 1].sequence + 1

    if (event.sequence !== expectedSequence && index > 0) {
      errors.push({
        type: "MISSING_SEQUENCE",
        sequence: expectedSequence,
        eventId: event.eventId,
        message: `Missing sequence number ${expectedSequence}. Expected ${expectedSequence}, got ${event.sequence}`,
      })
    }

    if (!event.eventId || !event.action || !event.targetType || !event.timestamp || !event.previousHash || !event.eventHash) {
      errors.push({
        type: "MALFORMED_EVENT",
        sequence: event.sequence,
        eventId: event.eventId,
        message: `Malformed event at sequence ${event.sequence}. Missing required fields.`,
      })
      continue
    }

    if (event.previousHash !== expectedPreviousHash) {
      errors.push({
        type: "BROKEN_CHAIN",
        sequence: event.sequence,
        eventId: event.eventId,
        message: `Broken chain at sequence ${event.sequence}. Previous hash mismatch.`,
        details: { expected: expectedPreviousHash, actual: event.previousHash },
      })
    }

    const canonicalData = canonicalizeEventData(buildCanonicalAuditEventData(event))
    if (event.canonicalData !== canonicalData) {
      errors.push({
        type: "INVALID_HASH",
        sequence: event.sequence,
        eventId: event.eventId,
        message: `Canonical data mismatch at sequence ${event.sequence}.`,
      })
    }

    const recomputedHash = computeEventHash(event.previousHash + canonicalData)
    if (event.eventHash !== recomputedHash) {
      errors.push({
        type: "INVALID_HASH",
        sequence: event.sequence,
        eventId: event.eventId,
        message: `Invalid hash at sequence ${event.sequence}. Event may have been modified.`,
      })
    }

    if (event.isLegacy) {
      warnings.push({
        type: "LEGACY_EVENTS",
        message: `Legacy event ${event.eventId} is included but cannot prove pre-migration history.`,
      })
    }

    expectedPreviousHash = event.eventHash
    eventsVerified++
  }

  if (payload.manifest?.startSequence !== undefined && events[0]?.sequence !== payload.manifest.startSequence) {
    errors.push({
      type: "MISSING_SEQUENCE",
      sequence: payload.manifest.startSequence,
      message: "Manifest start sequence does not match first exported event",
    })
  }

  if (payload.manifest?.endSequence !== undefined && events.at(-1)?.sequence !== payload.manifest.endSequence) {
    errors.push({
      type: "MISSING_SEQUENCE",
      sequence: payload.manifest.endSequence,
      message: "Manifest end sequence does not match last exported event",
    })
  }

  if (payload.manifest?.startEventHash && events[0]?.eventHash !== payload.manifest.startEventHash) {
    errors.push({
      type: "INVALID_HASH",
      sequence: events[0]?.sequence,
      message: "Manifest start event hash does not match first exported event",
    })
  }

  if (payload.manifest?.endEventHash && events.at(-1)?.eventHash !== payload.manifest.endEventHash) {
    errors.push({
      type: "INVALID_HASH",
      sequence: events.at(-1)?.sequence,
      message: "Manifest end event hash does not match last exported event",
    })
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    summary: {
      totalEvents: events.length,
      eventsVerified,
      firstSequence: events[0]?.sequence || 0,
      lastSequence: events.at(-1)?.sequence || 0,
      partition,
      checkpointsVerified: Array.isArray(payload.checkpoints) ? payload.checkpoints.length : undefined,
    },
  }
}

/**
 * Detect deleted or reordered events
 */
export async function detectAnomalies(partition: string): Promise<{
  missingSequences: number[]
  duplicateSequences: number[]
  outOfOrderEvents: Array<{ sequence: number; timestamp: Date }>
}> {
  await dbConnect()

  const events = await TamperEvidentAuditLog.find({ partition, isLegacy: false })
    .sort({ sequence: 1 })
    .lean()

  const missingSequences: number[] = []
  const duplicateSequences: number[] = []
  const outOfOrderEvents: Array<{ sequence: number; timestamp: Date }> = []

  const sequenceCounts: Record<number, number> = {}

  // Check for duplicates
  for (const event of events) {
    sequenceCounts[event.sequence] = (sequenceCounts[event.sequence] || 0) + 1
  }

  for (const [seq, count] of Object.entries(sequenceCounts)) {
    if (count > 1) {
      duplicateSequences.push(Number(seq))
    }
  }

  // Check for missing sequences
  if (events.length > 0) {
    const firstSeq = events[0].sequence
    const lastSeq = events[events.length - 1].sequence

    for (let seq = firstSeq; seq <= lastSeq; seq++) {
      if (!sequenceCounts[seq]) {
        missingSequences.push(seq)
      }
    }
  }

  // Check for out-of-order timestamps
  for (let i = 1; i < events.length; i++) {
    if (new Date(events[i].timestamp) < new Date(events[i - 1].timestamp)) {
      outOfOrderEvents.push({
        sequence: events[i].sequence,
        timestamp: events[i].timestamp,
      })
    }
  }

  return {
    missingSequences,
    duplicateSequences,
    outOfOrderEvents,
  }
}
