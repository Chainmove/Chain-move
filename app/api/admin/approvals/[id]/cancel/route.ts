import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { cancelApprovalRequest } from "@/lib/approvals/service"
import { ApprovalError, type ApprovalErrorCode } from "@/lib/approvals/errors"
import { serializeApprovalRequest } from "@/lib/approvals/serialize"

interface RouteContext {
  params: Promise<{ id: string }>
}

const APPROVAL_ERROR_STATUS: Partial<Record<ApprovalErrorCode, number>> = {
  not_found: 404,
  not_pending: 409,
  forbidden: 403,
  conflict: 409,
}

export async function POST(request: Request, { params }: RouteContext) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (user.role !== "admin") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const body = await request.json().catch(() => ({}))

    const updated = await cancelApprovalRequest({
      requestId: id,
      actor: { id: user._id.toString(), role: user.role },
      reason: typeof body.reason === "string" ? body.reason : undefined,
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
    console.error("ADMIN_APPROVAL_CANCEL_ERROR", error)
    return NextResponse.json({ message: "Failed to cancel request." }, { status: 500 })
  }
}
