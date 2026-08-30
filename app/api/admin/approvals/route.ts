import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { listApprovalRequests } from "@/lib/approvals/service"
import { serializeApprovalRequest } from "@/lib/approvals/serialize"

export async function GET(request: Request) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (user.role !== "admin") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get("status") || undefined
    const operationType = searchParams.get("operationType") || undefined
    const page = Number(searchParams.get("page") || "1")
    const pageSize = Number(searchParams.get("pageSize") || "20")

    const result = await listApprovalRequests({ status, operationType, page, pageSize })

    const response = NextResponse.json({
      success: true,
      requests: result.requests.map(serializeApprovalRequest),
      pagination: { page: result.page, pageSize: result.pageSize, total: result.total },
    })
    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    console.error("ADMIN_APPROVALS_GET_ERROR", error)
    return NextResponse.json({ message: "Failed to fetch approval requests." }, { status: 500 })
  }
}
