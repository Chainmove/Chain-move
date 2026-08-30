import type { IApprovalRequest } from "@/models/ApprovalRequest"

export function serializeApprovalRequest(request: IApprovalRequest) {
  return {
    id: request._id.toString(),
    operationType: request.operationType,
    riskLevel: request.riskLevel,
    targetType: request.targetType,
    targetId: request.targetId,
    status: request.status,
    reason: request.reason,
    evidenceRefs: request.evidenceRefs,
    beforeState: request.beforeState,
    afterState: request.afterState,
    requesterId: request.requesterId,
    requesterRole: request.requesterRole,
    approverId: request.approverId ?? null,
    decisionReason: request.decisionReason ?? null,
    decidedAt: request.decidedAt ? request.decidedAt.toISOString() : null,
    expiresAt: request.expiresAt.toISOString(),
    executedAt: request.executedAt ? request.executedAt.toISOString() : null,
    executionError: request.executionError ?? null,
    resultRefs: request.resultRefs,
    emergencyOverride: request.emergencyOverride,
    emergencyOverrideReason: request.emergencyOverrideReason ?? null,
    history: request.history.map((event) => ({
      event: event.event,
      actorId: event.actorId ?? null,
      at: event.at.toISOString(),
      reason: event.reason ?? null,
    })),
    createdAt: request.createdAt.toISOString(),
    updatedAt: request.updatedAt.toISOString(),
  }
}

export type SerializedApprovalRequest = ReturnType<typeof serializeApprovalRequest>
