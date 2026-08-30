import crypto from "crypto"
import dbConnect from "@/lib/dbConnect"
import AuditCheckpoint from "@/models/AuditCheckpoint"
import TamperEvidentAuditLog from "@/models/TamperEvidentAuditLog"
import { computeRootHash } from "./audit-hash"

// Simple local signer for contributor mode
// In production, this should be replaced with a proper HSM or KMS integration
class LocalCheckpointSigner {
  private privateKey: string
  private previousKeys: string[]

  constructor() {
    // In production, this should be loaded from secure environment variable or key management service
    this.privateKey = process.env.AUDIT_CHECKPOINT_PRIVATE_KEY || this.generateKeyPair()
    this.previousKeys = (process.env.AUDIT_CHECKPOINT_PREVIOUS_KEYS || "")
      .split(",")
      .map((key) => key.trim())
      .filter(Boolean)
  }

  private generateKeyPair(): string {
    // Generate a simple signing key for development
    return crypto.randomBytes(32).toString("hex")
  }

  sign(data: string): string {
    const hmac = crypto.createHmac("sha256", this.privateKey)
    hmac.update(data)
    return hmac.digest("hex")
  }

  verify(data: string, signature: string): boolean {
    return [this.privateKey, ...this.previousKeys].some((key) => {
      const hmac = crypto.createHmac("sha256", key)
      hmac.update(data)
      const expectedSignature = hmac.digest("hex")
      const actual = Buffer.from(signature, "hex")
      const expected = Buffer.from(expectedSignature, "hex")
      return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
    })
  }

  getKeyIdentifier(): string {
    // Return a hash of the public portion or key ID
    return crypto.createHash("sha256").update(this.privateKey).digest("hex").slice(0, 16)
  }
}

const localSigner = new LocalCheckpointSigner()

export interface CheckpointConfig {
  partition: string
  eventsPerCheckpoint?: number
  autoCheckpoint?: boolean
}

/**
 * Create a checkpoint for a partition
 */
export async function createCheckpoint(partition: string): Promise<{
  success: boolean
  checkpoint?: {
    checkpointNumber: number
    eventCount: number
    rootHash: string
  }
  error?: string
}> {
  try {
    await dbConnect()

    // Get the last checkpoint for this partition
    const lastCheckpoint = await AuditCheckpoint.findOne({ partition }).sort({ checkpointNumber: -1 })
    const nextCheckpointNumber = lastCheckpoint ? lastCheckpoint.checkpointNumber + 1 : 1
    const startSequence = lastCheckpoint ? lastCheckpoint.endSequence + 1 : 0

    // Get all events since the last checkpoint
    const events = await TamperEvidentAuditLog.find({
      partition,
      sequence: { $gte: startSequence },
      isLegacy: false,
    }).sort({ sequence: 1 })

    if (events.length === 0) {
      return {
        success: false,
        error: "No new events to checkpoint",
      }
    }

    const endSequence = events[events.length - 1].sequence
    const startEventHash = events[0].eventHash
    const endEventHash = events[events.length - 1].eventHash
    const eventHashes = events.map((e) => e.eventHash)
    const rootHash = computeRootHash(eventHashes)

    // Sign the checkpoint
    const signatureData = JSON.stringify({
      partition,
      checkpointNumber: nextCheckpointNumber,
      startSequence,
      endSequence,
      rootHash,
    })
    const signature = localSigner.sign(signatureData)
    const signedBy = localSigner.getKeyIdentifier()

    // Create the checkpoint
    const checkpoint = await AuditCheckpoint.create({
      partition,
      checkpointNumber: nextCheckpointNumber,
      startSequence,
      endSequence,
      startEventHash,
      endEventHash,
      rootHash,
      signature,
      signedBy,
      signedAt: new Date(),
      eventCount: events.length,
    })

    return {
      success: true,
      checkpoint: {
        checkpointNumber: checkpoint.checkpointNumber,
        eventCount: checkpoint.eventCount,
        rootHash: checkpoint.rootHash,
      },
    }
  } catch (error) {
    console.error("CHECKPOINT_CREATE_ERROR", error)
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * Verify a checkpoint signature
 */
export async function verifyCheckpointSignature(checkpointId: string): Promise<{
  valid: boolean
  error?: string
}> {
  try {
    await dbConnect()

    const checkpoint = await AuditCheckpoint.findById(checkpointId)
    if (!checkpoint) {
      return { valid: false, error: "Checkpoint not found" }
    }

    const signatureData = JSON.stringify({
      partition: checkpoint.partition,
      checkpointNumber: checkpoint.checkpointNumber,
      startSequence: checkpoint.startSequence,
      endSequence: checkpoint.endSequence,
      rootHash: checkpoint.rootHash,
    })

    const valid = localSigner.verify(signatureData, checkpoint.signature)

    return { valid }
  } catch (error) {
    console.error("CHECKPOINT_VERIFY_ERROR", error)
    return {
      valid: false,
      error: error instanceof Error ? error.message : "Unknown error",
    }
  }
}

/**
 * Get checkpoint statistics for a partition
 */
export async function getCheckpointStats(partition: string): Promise<{
  totalCheckpoints: number
  lastCheckpoint?: {
    number: number
    eventCount: number
    signedAt: Date
  }
  totalEventsCheckpointed: number
}> {
  await dbConnect()

  const checkpoints = await AuditCheckpoint.find({ partition }).sort({ checkpointNumber: -1 })

  const totalCheckpoints = checkpoints.length
  const lastCheckpoint = checkpoints[0]
  const totalEventsCheckpointed = checkpoints.reduce((sum, cp) => sum + cp.eventCount, 0)

  return {
    totalCheckpoints,
    lastCheckpoint: lastCheckpoint
      ? {
          number: lastCheckpoint.checkpointNumber,
          eventCount: lastCheckpoint.eventCount,
          signedAt: lastCheckpoint.signedAt,
        }
      : undefined,
    totalEventsCheckpointed,
  }
}

/**
 * Auto-checkpoint if threshold is met
 */
export async function autoCheckpointIfNeeded(partition: string, threshold: number = 1000): Promise<void> {
  await dbConnect()

  const lastCheckpoint = await AuditCheckpoint.findOne({ partition }).sort({ checkpointNumber: -1 })
  const startSequence = lastCheckpoint ? lastCheckpoint.endSequence + 1 : 0

  const eventCount = await TamperEvidentAuditLog.countDocuments({
    partition,
    sequence: { $gte: startSequence },
    isLegacy: false,
  })

  if (eventCount >= threshold) {
    await createCheckpoint(partition)
  }
}

export { localSigner }
