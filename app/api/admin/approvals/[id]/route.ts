import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { getApprovalRequestById } from "@/lib/approvals/service"
import { serializeApprovalRequest } from "@/lib/approvals/serialize"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, { params }: RouteContext) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (user.role !== "admin") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { id } = await params
    const approvalRequest = await getApprovalRequestById(id)
    if (!approvalRequest) {
      return NextResponse.json({ message: "Approval request not found." }, { status: 404 })
    }

    const response = NextResponse.json({ success: true, request: serializeApprovalRequest(approvalRequest) })
    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    console.error("ADMIN_APPROVAL_GET_ERROR", error)
    return NextResponse.json({ message: "Failed to fetch approval request." }, { status: 500 })
  }
}
