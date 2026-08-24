/**
 * Legal / operational holds for the privacy lifecycle.
 *
 * A hold pins one or more resources (or an entire user) so that the privacy
 * deletion pipeline refuses to remove or anonymize the affected data. Holds
 * are evaluated by:
 *
 *   - `evaluateDeletionEligibility` — called by the deletion service to
 *     determine if a request can proceed.
 *   - `listActiveHoldsForUser` — surfaced in admin views and the deletion
 *     response so the requester can see why a request is blocked.
 */

import { randomUUID } from "crypto"

import dbConnect from "@/lib/dbConnect"
import LegalHold, { type ILegalHold, type LegalHoldReason, type LegalHoldScope } from "@/models/LegalHold"
import { logAuditEvent } from "@/lib/security/audit-log"

export interface LegalHoldCreateInput {
  userId?: string
  resourceType?: LegalHoldScope
  resourceId?: string
  description?: string
  reason: LegalHoldReason
  reasonText?: string
  expiresAt?: Date
  reference?: string
  actor: { id: string; role: "admin" | "system" }
}

export interface LegalHoldReleaseInput {
  id: string
  reason: string
  actor: { id: string; role: "admin" | "system" }
}

export interface HoldEvaluationResult {
  blocked: boolean
  holds: ILegalHold[]
  reasons: string[]
}

export async function createLegalHold(input: LegalHoldCreateInput): Promise<ILegalHold> {
  await dbConnect()

  if (!input.userId && !(input.resourceType && input.resourceId)) {
    throw new Error("LegalHold requires either userId or (resourceType, resourceId).")
  }

  const id = `hold_${randomUUID()}`
  const now = new Date()

  const created = await LegalHold.create({
    id,
    userId: input.userId,
    resourceType: input.resourceType,
    resourceId: input.resourceId,
    description: input.description,
    reason: input.reason,
    reasonText: input.reasonText,
    expiresAt: input.expiresAt,
    reference: input.reference,
    status: "ACTIVE",
    createdBy: input.actor.id,
    createdByRole: input.actor.role,
    history: [
      {
        event: "created",
        actor: input.actor.id,
        actorType: input.actor.role,
        reason: input.reasonText || input.reason,
        metadata: { userId: input.userId, resourceType: input.resourceType, resourceId: input.resourceId },
        at: now,
      },
    ],
  })

  await logAuditEvent({
    actor: { _id: input.actor.id, role: input.actor.role },
    action: "privacy.hold.created",
    targetType: "LegalHold",
    targetId: id,
    status: "success",
    metadata: {
      reason: input.reason,
      userId: input.userId,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      expiresAt: input.expiresAt?.toISOString(),
    },
  })

  return created
}

export async function releaseLegalHold(input: LegalHoldReleaseInput): Promise<ILegalHold | null> {
  await dbConnect()

  const hold = await LegalHold.findOne({ id: input.id })
  if (!hold) return null
  if (hold.status !== "ACTIVE") return hold

  hold.status = "RELEASED"
  hold.releasedAt = new Date()
  hold.releasedBy = input.actor.id
  hold.releaseReason = input.reason
  hold.history.push({
    event: "released",
    actor: input.actor.id,
    actorType: input.actor.role,
    reason: input.reason,
    at: new Date(),
  })
  await hold.save()

  await logAuditEvent({
    actor: { _id: input.actor.id, role: input.actor.role },
    action: "privacy.hold.released",
    targetType: "LegalHold",
    targetId: hold.id,
    status: "success",
    metadata: {
      reason: input.reason,
      userId: hold.userId,
      resourceType: hold.resourceType,
      resourceId: hold.resourceId,
    },
  })

  return hold
}

export async function expireLegalHolds(now: Date = new Date()): Promise<number> {
  await dbConnect()

  const expired = await LegalHold.find({
    status: "ACTIVE",
    expiresAt: { $lte: now },
  })

  for (const hold of expired) {
    hold.status = "EXPIRED"
    hold.history.push({
      event: "expired",
      actor: "system",
      actorType: "system",
      reason: "automatic expiry",
      at: now,
    })
    await hold.save()
  }

  if (expired.length > 0) {
    await logAuditEvent({
      actor: null,
      action: "privacy.hold.expired_bulk",
      targetType: "LegalHold",
      targetId: "bulk",
      status: "success",
      metadata: { count: expired.length, at: now.toISOString() },
    })
  }

  return expired.length
}

export async function listActiveHoldsForUser(userId: string): Promise<ILegalHold[]> {
  await dbConnect()
  const now = new Date()
  const holds = await LegalHold.find({
    status: "ACTIVE",
    $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
    $and: [
      {
        $or: [
          { userId },
          // Holds on resources owned by this user are evaluated by the
          // deletion pipeline against per-resource references.
        ],
      },
    ],
  }).lean()

  return holds
}

export async function listAllHolds(filter: { status?: "ACTIVE" | "RELEASED" | "EXPIRED" } = {}): Promise<ILegalHold[]> {
  await dbConnect()
  const status = filter.status || "ACTIVE"
  return LegalHold.find({ status }).sort({ createdAt: -1 }).lean()
}

/**
 * Evaluates whether a privacy deletion request can proceed. Returns the
 * blocking holds (with their reasons) so the requester can show the user
 * why their request was not actioned.
 */
export async function evaluateDeletionEligibility({
  userId,
  resourceRefs = [],
}: {
  userId: string
  /** Resource references that will be affected by the deletion. */
  resourceRefs?: { resourceType: LegalHoldScope; resourceId: string }[]
}): Promise<HoldEvaluationResult> {
  await dbConnect()
  const now = new Date()
  const orFilters: any[] = [{ userId }]
  for (const ref of resourceRefs) {
    orFilters.push({ resourceType: ref.resourceType, resourceId: ref.resourceId })
  }

  const holds = await LegalHold.find({
    status: "ACTIVE",
    $or: orFilters,
    $and: [
      {
        $or: [{ expiresAt: { $exists: false } }, { expiresAt: null }, { expiresAt: { $gt: now } }],
      },
    ],
  }).lean()

  return {
    blocked: holds.length > 0,
    holds,
    reasons: holds.map((h) => `${h.reason}${h.reasonText ? `: ${h.reasonText}` : ""}`),
  }
}

export function summarizeHoldsForAdmin(holds: ILegalHold[]) {
  return holds.map((h) => ({
    id: h.id,
    userId: h.userId,
    resourceType: h.resourceType,
    resourceId: h.resourceId,
    reason: h.reason,
    reasonText: h.reasonText,
    reference: h.reference,
    expiresAt: h.expiresAt?.toISOString() || null,
    createdBy: h.createdBy,
    createdAt: h.createdAt,
    status: h.status,
  }))
}
