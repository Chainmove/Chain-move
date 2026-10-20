/**
 * Webhook Inbox Service
 *
 * Durably persists verified Paystack webhook events before any domain
 * processing.  Supports idempotent processing, exponential-backoff retries,
 * dead-letter quarantine, and admin-only replay with audit trail.
 */

import dbConnect from "@/lib/dbConnect"
import { logAuditEvent } from "@/lib/security/audit-log"
import WebhookInboxEvent, {
  computeNextRetryAt,
  hashPayload,
  type IWebhookInboxEvent,
} from "@/models/WebhookInboxEvent"

export interface IngestWebhookResult {
  inboxId: string
  correlationId: string
  /** true when this exact delivery was already stored (duplicate) */
  duplicate: boolean
  /** true when a different payload arrived for the same providerEventId */
  conflicting: boolean
}

/**
 * Persists the raw verified event envelope.  Must be called immediately after
 * signature verification, before any domain work.
 *
 * Returns duplicate=true when the identical delivery was already recorded so
 * the caller can skip re-processing.  Returns conflicting=true when a
 * different payload arrived for the same providerEventId — the new event is
 * stored as dead_letter for investigation.
 */
export async function ingestWebhookEvent(
  providerEventId: string,
  eventType: string,
  rawPayload: string,
): Promise<IngestWebhookResult> {
  await dbConnect()

  const payloadHash = hashPayload(rawPayload)

  // Check for an existing record first
  const existing = await WebhookInboxEvent.findOne({ providerEventId }).lean()

  if (existing) {
    if (existing.payloadHash === payloadHash) {
      return {
        inboxId: existing._id.toString(),
        correlationId: existing.correlationId,
        duplicate: true,
        conflicting: false,
      }
    }

    // Different payload for same providerEventId — quarantine as dead_letter
    const conflictEvent = await WebhookInboxEvent.create({
      providerEventId: `${providerEventId}__conflict__${payloadHash.slice(0, 8)}`,
      eventType,
      payloadHash,
      rawPayload,
      status: "dead_letter",
      lastError: `Conflicting payload detected for providerEventId ${providerEventId}`,
    })

    await logAuditEvent({
      action: "webhook.conflict_detected",
      targetType: "webhook_event",
      targetId: providerEventId,
      status: "failure",
      metadata: { existingHash: existing.payloadHash, incomingHash: payloadHash },
    })

    return {
      inboxId: conflictEvent._id.toString(),
      correlationId: conflictEvent.correlationId,
      duplicate: false,
      conflicting: true,
    }
  }

  const event = await WebhookInboxEvent.create({
    providerEventId,
    eventType,
    payloadHash,
    rawPayload,
    status: "pending",
    nextRetryAt: new Date(),
  })

  return {
    inboxId: event._id.toString(),
    correlationId: event.correlationId,
    duplicate: false,
    conflicting: false,
  }
}

/** Mark event as completed after successful domain processing */
export async function markWebhookCompleted(inboxId: string): Promise<void> {
  await WebhookInboxEvent.findByIdAndUpdate(inboxId, {
    status: "completed",
    processedAt: new Date(),
    nextRetryAt: null,
    lastError: null,
  })
}

/**
 * Record a processing failure.  Increments attempts and schedules a retry
 * with exponential backoff.  Moves to dead_letter once maxAttempts is reached.
 */
export async function markWebhookFailed(
  inboxId: string,
  errorMessage: string,
): Promise<void> {
  const event = await WebhookInboxEvent.findById(inboxId)
  if (!event) return

  const attempts = event.attempts + 1
  const dead = attempts >= event.maxAttempts

  await WebhookInboxEvent.findByIdAndUpdate(inboxId, {
    status: dead ? "dead_letter" : "failed",
    attempts,
    lastError: errorMessage,
    nextRetryAt: dead ? null : computeNextRetryAt(attempts),
  })

  if (dead) {
    await logAuditEvent({
      action: "webhook.dead_lettered",
      targetType: "webhook_event",
      targetId: event.providerEventId,
      status: "failure",
      metadata: { inboxId, attempts, lastError: errorMessage },
    })
  }
}

export interface ReplayWebhookOptions {
  adminUserId: string
  reason: string
}

/**
 * Admin-only replay.  Resets a dead_letter or failed event back to pending so
 * it will be picked up on the next processing cycle.  Idempotent — replaying
 * a completed event is a no-op and returns false.
 */
export async function replayWebhookEvent(
  inboxId: string,
  { adminUserId, reason }: ReplayWebhookOptions,
): Promise<{ replayed: boolean; alreadyCompleted: boolean }> {
  const event = await WebhookInboxEvent.findById(inboxId)
  if (!event) throw new Error(`Webhook inbox event not found: ${inboxId}`)

  if (event.status === "completed") {
    return { replayed: false, alreadyCompleted: true }
  }

  await WebhookInboxEvent.findByIdAndUpdate(inboxId, {
    status: "pending",
    attempts: 0,
    lastError: null,
    nextRetryAt: new Date(),
    replayedAt: new Date(),
    replayedBy: adminUserId,
    replayReason: reason,
  })

  await logAuditEvent({
    action: "webhook.replayed",
    targetType: "webhook_event",
    targetId: event.providerEventId,
    metadata: { inboxId, adminUserId, reason },
  })

  return { replayed: true, alreadyCompleted: false }
}

/** Fetch events ready for retry (pending / failed with nextRetryAt <= now) */
export async function fetchRetryableWebhookEvents(
  limit = 20,
): Promise<IWebhookInboxEvent[]> {
  return WebhookInboxEvent.find({
    status: { $in: ["pending", "failed"] },
    nextRetryAt: { $lte: new Date() },
  })
    .sort({ nextRetryAt: 1 })
    .limit(limit)
    .lean() as Promise<IWebhookInboxEvent[]>
}

/** Purge completed events older than `retentionDays` days */
export async function purgeOldWebhookEvents(retentionDays = 90): Promise<number> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const result = await WebhookInboxEvent.deleteMany({
    status: "completed",
    processedAt: { $lt: cutoff },
  })
  return result.deletedCount ?? 0
}
