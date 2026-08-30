import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import ApprovalRequest, { type ApprovalOperationType, type IApprovalRequest } from "@/models/ApprovalRequest"
import { logAuditEvent } from "@/lib/security/audit-log"
import { getExecutor } from "./executors"
import { ApprovalError } from "./errors"

const DEFAULT_TTL_HOURS = Number(process.env.APPROVAL_REQUEST_TTL_HOURS || 72)
/** A request stuck in "executing" past this window is treated as failed (crash recovery). */
const EXECUTION_TIMEOUT_MS = 5 * 60 * 1000

interface Actor {
  id: string
  role: string
}

/** Only an actor who currently holds the admin role may request or decide these operations. */
async function hasAdminPermission(userId: string): Promise<boolean> {
  const user = await User.findById(userId).select("role").lean()
  return Boolean(user && user.role === "admin")
}

function isMongoDuplicateKeyError(error: unknown) {
  return typeof error === "object" && error !== null && (error as { code?: number }).code === 11000
}

/**
 * Lazily reconciles requests whose clock has run out before anyone acts on
 * them: a "pending" request past its expiry, or an "executing" request whose
 * process crashed mid-flight before it could reach a terminal status.
 */
async function reapStaleRequest(request: IApprovalRequest): Promise<IApprovalRequest> {
  const now = new Date()

  if (request.status === "pending" && request.expiresAt.getTime() <= now.getTime()) {
    const updated = await ApprovalRequest.findOneAndUpdate(
      { _id: request._id, status: "pending" },
      { $set: { status: "expired" }, $push: { history: { event: "expired", at: now } } },
      { new: true },
    )
    return updated || request
  }

  if (request.status === "executing" && now.getTime() - request.updatedAt.getTime() > EXECUTION_TIMEOUT_MS) {
    const updated = await ApprovalRequest.findOneAndUpdate(
      { _id: request._id, status: "executing" },
      {
        $set: { status: "execution_failed", executionError: "Execution timed out (stuck in-flight)." },
        $push: { history: { event: "execution_failed", at: now, reason: "stuck_execution_timeout" } },
      },
      { new: true },
    )
    return updated || request
  }

  return request
}

export async function getApprovalRequestById(requestId: string): Promise<IApprovalRequest | null> {
  await dbConnect()
  const request = await ApprovalRequest.findById(requestId)
  if (!request) return null
  return reapStaleRequest(request)
}

export async function listApprovalRequests(filter: {
  status?: string
  operationType?: string
  page?: number
  pageSize?: number
} = {}) {
  await dbConnect()
  const page = Math.max(1, filter.page || 1)
  const pageSize = Math.min(100, Math.max(1, filter.pageSize || 20))

  const query: Record<string, unknown> = {}
  if (filter.status) query.status = filter.status
  if (filter.operationType) query.operationType = filter.operationType

  const candidates = await ApprovalRequest.find(query)
    .sort({ createdAt: -1 })
    .skip((page - 1) * pageSize)
    .limit(pageSize)

  const requests = await Promise.all(candidates.map(reapStaleRequest))
  const total = await ApprovalRequest.countDocuments(query)

  return { requests, total, page, pageSize }
}

export async function createApprovalRequest(input: {
  operationType: ApprovalOperationType
  targetId: string
  rawCommand: Record<string, unknown>
  requester: Actor
  reason: string
}): Promise<{ request: IApprovalRequest; autoExecuted: boolean }> {
  await dbConnect()

  if (!input.reason || !input.reason.trim()) {
    throw new ApprovalError("invalid_command", "A reason is required to request this operation.")
  }

  const executor = getExecutor(input.operationType)
  const prepared = await executor.prepare(input.targetId, input.rawCommand)

  // Fail fast: don't create a request doomed to fail revalidation later.
  await executor.revalidate(input.targetId, prepared.command)

  const resourceVersion = await executor.loadResourceVersion(input.targetId)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DEFAULT_TTL_HOURS * 3600_000)

  if (prepared.exempt) {
    let doc: IApprovalRequest
    try {
      doc = await ApprovalRequest.create({
        operationType: input.operationType,
        riskLevel: "standard",
        targetType: executor.targetType,
        targetId: input.targetId,
        resourceVersion,
        proposedCommand: prepared.command,
        beforeState: prepared.before,
        afterState: prepared.after,
        requesterId: input.requester.id,
        requesterRole: input.requester.role,
        reason: input.reason.trim(),
        evidenceRefs: prepared.evidenceRefs,
        status: "executing",
        expiresAt,
        history: [{ event: "requested", actorId: input.requester.id, at: now, reason: "exempt_low_risk" }],
      })
    } catch (error) {
      if (isMongoDuplicateKeyError(error)) {
        throw new ApprovalError("already_in_flight", "An approval request is already in flight for this target.")
      }
      throw error
    }

    try {
      const result = await executor.execute(input.targetId, prepared.command, {
        approverId: input.requester.id,
        requesterId: input.requester.id,
      })
      const executed = await ApprovalRequest.findByIdAndUpdate(
        doc._id,
        {
          $set: { status: "executed", executedAt: new Date(), resultRefs: result.resultRefs },
          $push: { history: { event: "exempt_executed", actorId: input.requester.id, at: new Date() } },
        },
        { new: true },
      )
      await logAuditEvent({
        actor: { _id: input.requester.id as unknown as { toString(): string }, role: input.requester.role },
        action: `approval.exempt_executed.${input.operationType}`,
        targetType: executor.targetType,
        targetId: input.targetId,
        metadata: { requestId: doc._id.toString(), command: prepared.command, resultRefs: result.resultRefs },
      })
      return { request: executed || doc, autoExecuted: true }
    } catch (error) {
      const message = error instanceof ApprovalError ? error.message : "Execution failed."
      await ApprovalRequest.findByIdAndUpdate(doc._id, {
        $set: { status: "execution_failed", executionError: message },
        $push: { history: { event: "execution_failed", at: new Date(), reason: message } },
      })
      throw error
    }
  }

  let doc: IApprovalRequest
  try {
    doc = await ApprovalRequest.create({
      operationType: input.operationType,
      riskLevel: "high",
      targetType: executor.targetType,
      targetId: input.targetId,
      resourceVersion,
      proposedCommand: prepared.command,
      beforeState: prepared.before,
      afterState: prepared.after,
      requesterId: input.requester.id,
      requesterRole: input.requester.role,
      reason: input.reason.trim(),
      evidenceRefs: prepared.evidenceRefs,
      status: "pending",
      expiresAt,
      history: [{ event: "requested", actorId: input.requester.id, at: now }],
    })
  } catch (error) {
    if (isMongoDuplicateKeyError(error)) {
      throw new ApprovalError("already_in_flight", "An approval request is already in flight for this target.")
    }
    throw error
  }

  await logAuditEvent({
    actor: { _id: input.requester.id as unknown as { toString(): string }, role: input.requester.role },
    action: `approval.requested.${input.operationType}`,
    targetType: executor.targetType,
    targetId: input.targetId,
    metadata: { requestId: doc._id.toString() },
  })

  return { request: doc, autoExecuted: false }
}

async function executeClaimedRequest(request: IApprovalRequest, approver: Actor): Promise<IApprovalRequest> {
  const executor = getExecutor(request.operationType)

  // Atomically claim execution so a duplicated/replayed approval call cannot
  // execute the same request twice.
  const claimed = await ApprovalRequest.findOneAndUpdate(
    { _id: request._id, status: "approved" },
    { $set: { status: "executing" }, $push: { history: { event: "executing", at: new Date() } } },
    { new: true },
  )
  if (!claimed) {
    throw new ApprovalError("conflict", "Approval request is no longer awaiting execution.")
  }

  try {
    const currentVersion = await executor.loadResourceVersion(claimed.targetId)
    if (currentVersion !== claimed.resourceVersion) {
      await ApprovalRequest.updateOne(
        { _id: claimed._id, status: "executing" },
        { $set: { status: "stale" }, $push: { history: { event: "stale", at: new Date() } } },
      )
      throw new ApprovalError("stale_resource", "The target resource changed after this request was created.")
    }

    await executor.revalidate(claimed.targetId, claimed.proposedCommand)

    const result = await executor.execute(claimed.targetId, claimed.proposedCommand, {
      approverId: approver.id,
      requesterId: claimed.requesterId,
    })

    const executed = await ApprovalRequest.findOneAndUpdate(
      { _id: claimed._id, status: "executing" },
      {
        $set: { status: "executed", executedAt: new Date(), resultRefs: result.resultRefs },
        $push: { history: { event: "executed", actorId: approver.id, at: new Date() } },
      },
      { new: true },
    )

    await logAuditEvent({
      actor: { _id: approver.id as unknown as { toString(): string }, role: approver.role },
      action: `approval.executed.${request.operationType}`,
      targetType: request.targetType,
      targetId: request.targetId,
      metadata: { requestId: request._id.toString(), resultRefs: result.resultRefs },
    })

    return executed || claimed
  } catch (error) {
    const message = error instanceof ApprovalError ? error.message : "Execution failed."
    await ApprovalRequest.updateOne(
      { _id: claimed._id, status: "executing" },
      {
        $set: { status: "execution_failed", executionError: message },
        $push: { history: { event: "execution_failed", at: new Date(), reason: message } },
      },
    )
    await logAuditEvent({
      actor: { _id: approver.id as unknown as { toString(): string }, role: approver.role },
      action: `approval.execution_failed.${request.operationType}`,
      targetType: request.targetType,
      targetId: request.targetId,
      status: "failure",
      metadata: { requestId: request._id.toString(), error: message },
    })
    throw error
  }
}

export async function decideApprovalRequest(input: {
  requestId: string
  decision: "approve" | "reject"
  approver: Actor
  reason?: string
  emergencyOverride?: boolean
  emergencyOverrideReason?: string
}): Promise<IApprovalRequest> {
  await dbConnect()

  if (input.approver.role !== "admin") {
    throw new ApprovalError("forbidden", "Only an admin can decide an approval request.")
  }

  const request = await ApprovalRequest.findById(input.requestId)
  if (!request) throw new ApprovalError("not_found", "Approval request not found.")

  const reaped = await reapStaleRequest(request)
  if (reaped.status !== "pending") {
    throw new ApprovalError(
      reaped.status === "expired" ? "expired" : "not_pending",
      `Approval request is ${reaped.status}.`,
    )
  }

  if (String(reaped.requesterId) === String(input.approver.id)) {
    throw new ApprovalError("self_approval", "The requester cannot approve their own request.")
  }

  if (input.emergencyOverride && (!input.emergencyOverrideReason || input.emergencyOverrideReason.trim().length < 30)) {
    throw new ApprovalError(
      "invalid_command",
      "Emergency override requires a written justification of at least 30 characters.",
    )
  }

  const now = new Date()

  if (input.decision === "reject") {
    const updated = await ApprovalRequest.findOneAndUpdate(
      { _id: reaped._id, status: "pending" },
      {
        $set: { status: "rejected", approverId: input.approver.id, decisionReason: input.reason, decidedAt: now },
        $push: { history: { event: "rejected", actorId: input.approver.id, at: now, reason: input.reason } },
      },
      { new: true },
    )
    if (!updated) throw new ApprovalError("conflict", "Approval request was already decided.")

    await logAuditEvent({
      actor: { _id: input.approver.id as unknown as { toString(): string }, role: input.approver.role },
      action: `approval.rejected.${reaped.operationType}`,
      targetType: reaped.targetType,
      targetId: reaped.targetId,
      metadata: { requestId: reaped._id.toString(), reason: input.reason },
    })
    return updated
  }

  // Approval path: re-verify both sides of the four-eyes check still hold.
  // The approver's role is already fresh (loaded per-request by the caller),
  // but the requester's permission may have been revoked while this request
  // sat pending, so it is re-checked here explicitly.
  const [requesterEligible, approverEligible] = await Promise.all([
    hasAdminPermission(reaped.requesterId),
    hasAdminPermission(input.approver.id),
  ])

  if (!approverEligible) {
    throw new ApprovalError("approver_permission_revoked", "Your admin permission could not be verified.")
  }

  if (!requesterEligible) {
    await ApprovalRequest.findOneAndUpdate(
      { _id: reaped._id, status: "pending" },
      {
        $set: { status: "rejected", approverId: input.approver.id, decisionReason: "requester_lost_permission", decidedAt: now },
        $push: { history: { event: "auto_rejected", at: now, reason: "requester_lost_permission" } },
      },
    )
    throw new ApprovalError(
      "requester_permission_revoked",
      "The requester no longer holds the permission required for this action.",
    )
  }

  const historyEvent: Record<string, unknown> = { event: "approved", actorId: input.approver.id, at: now, reason: input.reason }
  const setFields: Record<string, unknown> = {
    status: "approved",
    approverId: input.approver.id,
    decisionReason: input.reason,
    decidedAt: now,
  }
  if (input.emergencyOverride) {
    setFields.emergencyOverride = true
    setFields.emergencyOverrideReason = input.emergencyOverrideReason
    historyEvent.event = "approved_emergency_override"
  }

  const claimed = await ApprovalRequest.findOneAndUpdate(
    { _id: reaped._id, status: "pending" },
    { $set: setFields, $push: { history: historyEvent } },
    { new: true },
  )
  if (!claimed) throw new ApprovalError("conflict", "Approval request was already decided.")

  if (input.emergencyOverride) {
    await logAuditEvent({
      actor: { _id: input.approver.id as unknown as { toString(): string }, role: input.approver.role },
      action: `approval.emergency_override.${reaped.operationType}`,
      targetType: reaped.targetType,
      targetId: reaped.targetId,
      metadata: { requestId: reaped._id.toString(), reason: input.emergencyOverrideReason },
      criticalAction: true,
    })
  }

  return executeClaimedRequest(claimed, input.approver)
}

export async function cancelApprovalRequest(input: {
  requestId: string
  actor: Actor
  reason?: string
}): Promise<IApprovalRequest> {
  await dbConnect()

  const request = await ApprovalRequest.findById(input.requestId)
  if (!request) throw new ApprovalError("not_found", "Approval request not found.")

  const reaped = await reapStaleRequest(request)
  if (reaped.status !== "pending") {
    throw new ApprovalError("not_pending", `Approval request is ${reaped.status}.`)
  }

  const isRequester = String(reaped.requesterId) === String(input.actor.id)
  if (!isRequester && input.actor.role !== "admin") {
    throw new ApprovalError("forbidden", "Only the requester or an admin can cancel this request.")
  }

  const now = new Date()
  const updated = await ApprovalRequest.findOneAndUpdate(
    { _id: reaped._id, status: "pending" },
    {
      $set: { status: "cancelled", decisionReason: input.reason, decidedAt: now },
      $push: { history: { event: "cancelled", actorId: input.actor.id, at: now, reason: input.reason } },
    },
    { new: true },
  )
  if (!updated) throw new ApprovalError("conflict", "Approval request was already decided.")

  await logAuditEvent({
    actor: { _id: input.actor.id as unknown as { toString(): string }, role: input.actor.role },
    action: `approval.cancelled.${reaped.operationType}`,
    targetType: reaped.targetType,
    targetId: reaped.targetId,
    metadata: { requestId: reaped._id.toString(), reason: input.reason },
  })

  return updated
}
