import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { previewRepair } from "@/lib/integrity/repairEngine"
import { createApprovalRequest } from "@/lib/approvals/service"
import { ApprovalError } from "@/lib/approvals/errors"

const APPROVAL_ERROR_STATUS: Partial<Record<ApprovalError["code"], number>> = {
  already_in_flight: 409,
  target_not_found: 404,
  invalid_command: 400,
  business_rule_violated: 409,
}

export async function POST(request: Request) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    if (user.role !== "admin") return NextResponse.json({ message: "Forbidden" }, { status: 403 })

    const body = await request.json()
    const { findingId, action = "preview", reason } = body

    if (!findingId) {
      return NextResponse.json({ success: false, error: "findingId is required" }, { status: 400 })
    }

    if (action === "preview") {
      const preview = await previewRepair(findingId)
      const response = NextResponse.json({ success: true, action: "preview", preview })
      return shouldRefreshSession ? withSessionRefresh(response, user) : response
    }

    if (action === "apply") {
      // The actor is always the authenticated caller now, never the
      // client-supplied `actor` string the old handler trusted verbatim.
      const { request: approvalRequest, autoExecuted } = await createApprovalRequest({
        operationType: "integrity.repair.apply",
        targetId: findingId,
        rawCommand: {},
        requester: { id: user._id.toString(), role: user.role },
        reason: reason || "Admin API repair request",
      })

      if (!autoExecuted) {
        const response = NextResponse.json(
          {
            success: true,
            action: "apply",
            pendingApproval: true,
            approvalRequestId: approvalRequest._id.toString(),
            message: "This repair requires a second admin's approval before it takes effect.",
          },
          { status: 202 },
        )
        return shouldRefreshSession ? withSessionRefresh(response, user) : response
      }

      const afterState = approvalRequest.afterState as { proposedChanges?: unknown; compensationPlan?: unknown }
      const response = NextResponse.json({
        success: true,
        action: "apply",
        result: {
          success: true,
          findingId,
          status: "REPAIRED",
          appliedChanges: afterState?.proposedChanges,
          compensationPlan: afterState?.compensationPlan,
        },
      })
      return shouldRefreshSession ? withSessionRefresh(response, user) : response
    }

    return NextResponse.json(
      { success: false, error: "Invalid action. Expected 'preview' or 'apply'" },
      { status: 400 },
    )
  } catch (error: any) {
    if (error instanceof ApprovalError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: APPROVAL_ERROR_STATUS[error.code] || 400 },
      )
    }
    return NextResponse.json(
      { success: false, error: error.message || "Failed to process repair" },
      { status: 500 },
    )
  }
}
