/**
 * Privacy request lifecycle orchestrator.
 *
 * Implements the full state machine:
 *
 *   REQUESTED  →  CONFIRMATION_PENDING  →  COOLING_OFF  →  PROCESSING  →  COMPLETED
 *                                                                              ↘ FAILED
 *   ↯ CANCELLED at any point before PROCESSING completes
 *
 * Each transition is appended to `auditHistory` and emitted to the global
 * audit log so external monitoring can observe the lifecycle.
 *
 * Idempotency: clients may send an `Idempotency-Key` header. A request with
 * the same key from the same user returns the existing request instead of
 * creating a duplicate.
 */

import { randomBytes } from "crypto"

import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import PrivacyRequest, {
  type IPrivacyRequest,
  type PrivacyRequestSource,
} from "@/models/PrivacyRequest"
import { executeDeletionPipeline } from "@/lib/privacy/privacy-deletion.service"
import { executeExportPipeline } from "@/lib/privacy/data-export.service"
import { logAuditEvent } from "@/lib/security/audit-log"

export const COOLING_OFF_MS = Number.parseInt(
  process.env.PRIVACY_COOLING_OFF_HOURS ? String(Number(process.env.PRIVACY_COOLING_OFF_HOURS) * 60 * 60 * 1000) : "86400000",
  10,
) || 24 * 60 * 60 * 1000

export const CONFIRMATION_TOKEN_TTL_MS = Number.parseInt(
  process.env.PRIVACY_CONFIRMATION_TTL_MINUTES ? String(Number(process.env.PRIVACY_CONFIRMATION_TTL_MINUTES) * 60 * 1000) : "3600000",
  10,
) || 60 * 60 * 1000

export interface RequestInput {
  userId: string
  requestType: "EXPORT" | "DELETION"
  source?: PrivacyRequestSource
  userNote?: string
  idempotencyKey?: string
}

function generateRequestId(type: "EXPORT" | "DELETION"): string {
  return `${type.toLowerCase()}_${randomBytes(10).toString("hex")}`
}

function generateConfirmationToken(): string {
  return randomBytes(24).toString("base64url")
}

/**
 * Create a new privacy request. Honors `idempotencyKey` so repeated calls
 * from the same user return the same request.
 */
export async function createPrivacyRequest(input: RequestInput): Promise<IPrivacyRequest> {
  await dbConnect()

  if (input.idempotencyKey) {
    const existing = await PrivacyRequest.findOne({
      userId: input.userId,
      idempotencyKey: input.idempotencyKey,
    })
    if (existing) return existing
  }

  const user = await User.findById(input.userId).select("_id role").lean()
  if (!user) {
    throw new Error("User not found.")
  }

  const now = new Date()
  const id = generateRequestId(input.requestType)
  const confirmationToken = generateConfirmationToken()
  const confirmationTokenExpiresAt = new Date(now.getTime() + CONFIRMATION_TOKEN_TTL_MS)

  const request = await PrivacyRequest.create({
    id,
    userId: input.userId,
    requestType: input.requestType,
    status: "CONFIRMATION_PENDING",
    source: input.source || "user",
    confirmationToken,
    confirmationTokenExpiresAt,
    idempotencyKey: input.idempotencyKey,
    userNote: input.userNote,
    auditHistory: [
      {
        kind: "created",
        actor: input.userId,
        actorType: input.source || "user",
        at: now,
        metadata: { requestType: input.requestType, idempotencyKey: input.idempotencyKey || null },
      },
      {
        kind: "confirmation_sent",
        actor: "system",
        actorType: "system",
        at: now,
        metadata: { confirmationTokenExpiresAt: confirmationTokenExpiresAt.toISOString() },
      },
    ],
  })

  await logAuditEvent({
    actor: { _id: input.userId, role: user.role },
    action: "privacy.request.created",
    targetType: "PrivacyRequest",
    targetId: id,
    status: "success",
    metadata: {
      requestType: input.requestType,
      idempotencyKey: input.idempotencyKey || null,
      confirmationTokenExpiresAt: confirmationTokenExpiresAt.toISOString(),
    },
  })

  return request
}

/**
 * Confirms the request with the token issued at creation. Transitions the
 * request into COOLING_OFF (deletions) or directly into PROCESSING (exports).
 */
export async function confirmPrivacyRequest({
  requestId,
  confirmationToken,
  actor,
}: {
  requestId: string
  confirmationToken: string
  actor: { id: string; role: "user" | "admin" }
}): Promise<IPrivacyRequest> {
  await dbConnect()

  const request = await PrivacyRequest.findOne({
    $or: [{ id: requestId }, ...(/^[0-9a-fA-F]{24}$/.test(requestId) ? [{ _id: requestId }] : [])],
  })
  if (!request) throw new Error("Privacy request not found.")

  if (request.userId !== actor.id && actor.role !== "admin") {
    throw new Error("Not authorized to confirm this request.")
  }

  if (request.status !== "CONFIRMATION_PENDING" && request.status !== "REQUESTED") {
    if (request.status === "COOLING_OFF" || request.status === "PROCESSING") {
      return request
    }
    throw new Error(`Cannot confirm a request in status ${request.status}.`)
  }

  if (!request.confirmationToken || request.confirmationToken !== confirmationToken) {
    throw new Error("Invalid confirmation token.")
  }

  if (
    request.confirmationTokenExpiresAt &&
    request.confirmationTokenExpiresAt.getTime() <= Date.now()
  ) {
    throw new Error("Confirmation token has expired.")
  }

  request.confirmationReceivedAt = new Date()

  if (request.requestType === "DELETION") {
    const now = new Date()
    request.status = "COOLING_OFF"
    request.coolingOffStartedAt = now
    request.coolingOffEndsAt = new Date(now.getTime() + COOLING_OFF_MS)
    request.auditHistory.push({
      kind: "confirmation_received",
      actor: actor.id,
      actorType: actor.role,
      at: now,
    })
    request.auditHistory.push({
      kind: "cooling_off_started",
      actor: actor.id,
      actorType: actor.role,
      at: now,
      metadata: { coolingOffEndsAt: request.coolingOffEndsAt.toISOString() },
    })
    await request.save()

    await logAuditEvent({
      actor: { _id: actor.id, role: actor.role },
      action: "privacy.deletion.confirmation_received",
      targetType: "PrivacyRequest",
      targetId: request.id,
      status: "success",
      metadata: { coolingOffEndsAt: request.coolingOffEndsAt.toISOString() },
    })

    return request
  }

  // EXPORT requests skip cooling-off — they immediately enter processing.
  request.auditHistory.push({
    kind: "confirmation_received",
    actor: actor.id,
    actorType: actor.role,
    at: new Date(),
  })
  await request.save()

  await executeExportPipeline(request, { actor: { id: actor.id, role: actor.role } })

  return request
}

/**
 * Cancels a request before it completes processing.
 */
export async function cancelPrivacyRequest({
  requestId,
  reason,
  actor,
}: {
  requestId: string
  reason: string
  actor: { id: string; role: "user" | "admin" }
}): Promise<IPrivacyRequest> {
  await dbConnect()

  const request = await PrivacyRequest.findOne({
    $or: [{ id: requestId }, ...(/^[0-9a-fA-F]{24}$/.test(requestId) ? [{ _id: requestId }] : [])],
  })
  if (!request) throw new Error("Privacy request not found.")

  if (request.userId !== actor.id && actor.role !== "admin") {
    throw new Error("Not authorized to cancel this request.")
  }

  if (["COMPLETED", "CANCELLED", "FAILED"].includes(request.status)) {
    return request
  }

  request.status = "CANCELLED"
  request.cancelledAt = new Date()
  request.cancelledBy = actor.id
  request.cancellationReason = reason
  request.auditHistory.push({
    kind: "cancelled",
    actor: actor.id,
    actorType: actor.role,
    reason,
    at: new Date(),
  })
  await request.save()

  await logAuditEvent({
    actor: { _id: actor.id, role: actor.role },
    action: "privacy.request.cancelled",
    targetType: "PrivacyRequest",
    targetId: request.id,
    status: "success",
    metadata: { reason, priorStatus: request.status },
  })

  return request
}

/**
 * Advances a request whose cooling-off period has elapsed into PROCESSING.
 * Safe to call repeatedly; idempotent.
 */
export async function advanceFromCoolingOff(requestId: string): Promise<IPrivacyRequest | null> {
  await dbConnect()

  const request = await PrivacyRequest.findOne({
    $or: [{ id: requestId }, ...(/^[0-9a-fA-F]{24}$/.test(requestId) ? [{ _id: requestId }] : [])],
  })
  if (!request) return null

  if (request.status !== "COOLING_OFF") return request
  if (!request.coolingOffEndsAt || request.coolingOffEndsAt.getTime() > Date.now()) return request

  await executeDeletionPipeline(request, { actor: { id: request.userId, role: "user" } })
  return request
}

/**
 * Sweeps all deletion requests whose cooling-off has elapsed and advances
 * them. Returns the number of requests advanced.
 */
export async function advanceDueCoolingOffRequests(now: Date = new Date()): Promise<number> {
  await dbConnect()
  const due = await PrivacyRequest.find({
    status: "COOLING_OFF",
    coolingOffEndsAt: { $lte: now },
  })

  for (const request of due) {
    try {
      await executeDeletionPipeline(request, { actor: { id: request.userId, role: "user" } })
    } catch (error) {
      console.error("PRIVACY_COOLING_OFF_ADVANCE_ERROR", error)
    }
  }

  return due.length
}

export function summarizeRequestForUser(request: IPrivacyRequest) {
  return {
    id: request.id,
    requestType: request.requestType,
    status: request.status,
    source: request.source,
    coolingOffEndsAt: request.coolingOffEndsAt?.toISOString() || null,
    confirmationReceivedAt: request.confirmationReceivedAt?.toISOString() || null,
    cancelledAt: request.cancelledAt?.toISOString() || null,
    blockReason: request.blockReason || null,
    blockingHoldIds: request.blockingHoldIds || [],
    archiveId: request.archiveId || null,
    steps: (request.steps || []).map((s) => ({
      stepId: s.stepId,
      label: s.label,
      status: s.status,
      affectedCount: s.affectedCount || 0,
      errorMessage: s.errorMessage || null,
    })),
    auditHistory: (request.auditHistory || []).map((e) => ({
      kind: e.kind,
      actor: e.actor || null,
      actorType: e.actorType || null,
      reason: e.reason || null,
      at: e.at?.toISOString() || null,
    })),
    lastError: request.lastError || null,
    createdAt: request.createdAt?.toISOString() || null,
    updatedAt: request.updatedAt?.toISOString() || null,
  }
}
