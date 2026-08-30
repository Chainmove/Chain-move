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
  invalid_command: 400,
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (user.role !== "admin") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const body = await request.json().catch(() => ({}))
    const reason = typeof body.reason === "string" ? body.reason.trim() : ""
    if (!reason) {
      return NextResponse.json({ message: "A rejection reason is required." }, { status: 400 })
    }

    const updated = await decideApprovalRequest({
      requestId: id,
      decision: "reject",
      approver: { id: user._id.toString(), role: user.role },
      reason,
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
    console.error("ADMIN_APPROVAL_REJECT_ERROR", error)
    return NextResponse.json({ message: "Failed to reject request." }, { status: 500 })
  }
}
