import { NextResponse } from "next/server"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import dbConnect from "@/lib/dbConnect"
import AuditLog from "@/models/AuditLog"

interface RouteContext {
  params: Promise<{ id: string }>
}

export async function GET(request: Request, context: RouteContext) {
  try {
    await dbConnect()

    const authContext = await requireAuthenticatedUser(request, ["admin"], {
      forbiddenMessage: "Admin access required",
    })
    if ("response" in authContext) return authContext.response

    const { id } = await context.params
    if (!id) {
      return NextResponse.json({ error: "User ID is required" }, { status: 400 })
    }

    // Retrieve all audit logs related to this user target ID
    const auditLogs = await AuditLog.find({ targetId: id })
      .sort({ createdAt: -1 })
      .limit(100)
      .lean()

    const response = NextResponse.json(auditLogs, { status: 200 })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("KYC_USER_AUDIT_LOG_GET_ERROR", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
