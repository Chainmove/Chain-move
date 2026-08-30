import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { decideApprovalRequest } from "@/lib/approvals/service"
import { ApprovalError, type ApprovalErrorCode } from "@/lib/approvals/errors"
import { serializeApprovalRequest } from "@/lib/approvals/serialize"

interface RouteContext {
  params: Promise<{ id: string }>
}

const APPROVAL_ERROR_STATUS: Partial<Record<ApprovalErrorCode, number>> = {
  not_found: 404,
  not_pending: 409,
  expired: 409,
  self_approval: 403,
  forbidden: 403,
  conflict: 409,
  requester_permission_revoked: 409,
  approver_permission_revoked: 403,
  invalid_command: 400,
  stale_resource: 409,
  business_rule_violated: 409,
  execution_failed: 422,
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (user.role !== "admin") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const updated = await decideApprovalRequest({
      requestId: id,
      decision: "approve",
      approver: { id: user._id.toString(), role: user.role },
      reason: typeof body.reason === "string" ? body.reason : undefined,
      emergencyOverride: Boolean(body.emergencyOverride),
      emergencyOverrideReason:
        typeof body.emergencyOverrideReason === "string" ? body.emergencyOverrideReason : undefined,
    })

    const response = NextResponse.json({ success: true, request: serializeApprovalRequest(updated) })
    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    if (error instanceof ApprovalError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: APPROVAL_ERROR_STATUS[error.code] || 400 },
      )
    }
    console.error("ADMIN_APPROVAL_APPROVE_ERROR", error)
    return NextResponse.json({ message: "Failed to approve request." }, { status: 500 })
  }
}
