import { NextResponse } from "next/server"
import { z } from "zod"

import dbConnect from "@/lib/dbConnect"
import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseJsonBody } from "@/lib/api/validation"
import SettlementRecord from "@/models/SettlementRecord"
import {
  evaluateFinalityTimeouts,
  transitionSettlementState,
} from "@/lib/settlement/settlement-service"

const postSchema = z.object({
  action: z.enum(["EVALUATE_TIMEOUTS", "FORCE_CONFIRM", "POST_REVERSAL", "MARK_EXPIRED", "RETRY_VERIFICATION"]),
  settlementId: z.string().optional(),
  providerReference: z.string().optional(),
  reason: z.string().optional(),
})

export async function GET(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in authContext) return authContext.response

    await dbConnect()

    const { searchParams } = new URL(request.url)
    const reference = searchParams.get("reference")
    const settlementId = searchParams.get("settlementId")
    const userId = searchParams.get("userId")
    const isStuck = searchParams.get("isStuck")
    const limit = Math.max(1, Math.min(Number(searchParams.get("limit") || 50), 200))
    const page = Math.max(1, Number(searchParams.get("page") || 1))

    const filter: Record<string, unknown> = {}
    if (reference) filter.providerReference = reference.trim()
    if (settlementId) filter.settlementId = settlementId.trim()
    if (userId) filter.userId = userId.trim()
    if (isStuck === "true") filter.isStuck = true
    if (isStuck === "false") filter.isStuck = false

    const total = await SettlementRecord.countDocuments(filter)
    const records = await SettlementRecord.find(filter)
      .sort({ updatedAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean()

    const response = NextResponse.json({
      success: true,
      total,
      page,
      limit,
      settlements: records,
    })

    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("SETTLEMENT_TIMELINE_GET_ERROR", error)
    const message = error instanceof Error ? error.message : "Internal server error."
    return NextResponse.json({ message }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in authContext) return authContext.response

    const body = await parseJsonBody(request, postSchema)
    if ("response" in body) return body.response

    await dbConnect()

    const { action, settlementId, providerReference, reason } = body.data

    if (action === "EVALUATE_TIMEOUTS") {
      const summary = await evaluateFinalityTimeouts()
      const response = NextResponse.json({ success: true, action, summary })
      return finalizeAuthenticatedResponse(response, authContext)
    }

    if (!settlementId && !providerReference) {
      return NextResponse.json(
        { message: "Either settlementId or providerReference is required for this action." },
        { status: 400 },
      )
    }

    const defaultReason = `Admin operator action '${action}' executed by ${authContext.user._id}`
    const finalReason = reason || defaultReason

    let targetState: any = "confirmed"
    if (action === "FORCE_CONFIRM") targetState = "confirmed"
    if (action === "POST_REVERSAL") targetState = "reversed"
    if (action === "MARK_EXPIRED") targetState = "expired"
    if (action === "RETRY_VERIFICATION") targetState = "provider-pending"

    const result = await transitionSettlementState({
      settlementId,
      providerReference,
      targetState,
      triggeredBy: "operator",
      reason: finalReason,
    })

    const response = NextResponse.json({
      success: true,
      action,
      settlement: result.settlement,
      previousState: result.previousState,
    })

    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("SETTLEMENT_TIMELINE_POST_ERROR", error)
    const message = error instanceof Error ? error.message : "Internal server error."
    return NextResponse.json({ message }, { status: 500 })
  }
}
