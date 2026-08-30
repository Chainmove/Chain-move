import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import dbConnect from "@/lib/dbConnect"
import ReconciliationDiscrepancy from "@/models/ReconciliationDiscrepancy"
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

    await dbConnect()
    const body = await request.json()
    const { discrepancyId, action, notes, reason } = body

    if (!discrepancyId || !action) {
      return NextResponse.json(
        { success: false, error: "discrepancyId and action are required" },
        { status: 400 },
      )
    }

    // The reviewer is always the authenticated caller, never a client-supplied
    // id — this closed a gap where any caller could attribute the remediation
    // to an arbitrary user.
    const { request: approvalRequest, autoExecuted } = await createApprovalRequest({
      operationType: "reconciliation.remediate",
      targetId: discrepancyId,
      rawCommand: { action, notes },
      requester: { id: user._id.toString(), role: user.role },
      reason: reason || notes || "Admin API remediation request",
    })

    if (!autoExecuted) {
      const response = NextResponse.json(
        {
          success: true,
          pendingApproval: true,
          approvalRequestId: approvalRequest._id.toString(),
          message: "This remediation requires a second admin's approval before it takes effect.",
        },
        { status: 202 },
      )
      return shouldRefreshSession ? withSessionRefresh(response, user) : response
    }

    const discrepancy = await ReconciliationDiscrepancy.findById(discrepancyId)
    const response = NextResponse.json({ success: true, discrepancy })
    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error: any) {
    if (error instanceof ApprovalError) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: APPROVAL_ERROR_STATUS[error.code] || 400 },
      )
    }
    return NextResponse.json(
      { success: false, error: error.message || "Failed to remediate discrepancy" },
      { status: 500 },
    )
  }
}
