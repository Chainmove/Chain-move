/**
 * POST /api/recovery/[id]/approve
 *
 * Admin-only: completes the high_risk_review factor and transitions the
 * recovery from cooling_off → approved. Only an admin reviewer can call this;
 * no single admin can both initiate and approve a recovery.
 */

import { NextResponse } from "next/server"
import { z } from "zod"
import dbConnect from "@/lib/dbConnect"
import WalletRecovery from "@/models/WalletRecovery"
import { getAuthenticatedUser } from "@/lib/auth/current-user"
import { parseJsonBody } from "@/lib/api/validation"
import { assertTransition, isCoolingOffComplete, isTerminal } from "@/lib/recovery/recovery-state-machine"
import { sendRecoveryNotifications } from "@/lib/recovery/recovery-notifications"
import User from "@/models/User"

const bodySchema = z.object({
  reviewNote: z.string().trim().min(10).max(2000),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect()
    const { id } = await params

    const { user } = await getAuthenticatedUser(request)
    if (!user || user.role !== "admin") {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    const body = await parseJsonBody(request, bodySchema)
    if ("response" in body) return body.response

    const recovery = await WalletRecovery.findById(id)
    if (!recovery) return NextResponse.json({ message: "Recovery request not found." }, { status: 404 })

    if (isTerminal(recovery.state)) {
      return NextResponse.json({ message: `Recovery is already ${recovery.state}.` }, { status: 409 })
    }

    if (recovery.state !== "cooling_off") {
      return NextResponse.json(
        { message: "Recovery must be in cooling_off state before admin approval." },
        { status: 409 },
      )
    }

    if (!recovery.coolingOffEndsAt || !isCoolingOffComplete(recovery.coolingOffEndsAt)) {
      const remaining = recovery.coolingOffEndsAt
        ? Math.ceil((recovery.coolingOffEndsAt.getTime() - Date.now()) / 3_600_000)
        : 72
      return NextResponse.json(
        { message: `Cooling-off period not yet complete. ${remaining} hour(s) remaining.` },
        { status: 409 },
      )
    }

    const reviewerFactor = recovery.factors.find((f) => f.type === "high_risk_review")
    if (!reviewerFactor) return NextResponse.json({ message: "Factor configuration error." }, { status: 500 })

    reviewerFactor.verified = true
    reviewerFactor.verifiedAt = new Date()
    recovery.highRiskReviewerId = user._id.toString()
    recovery.highRiskReviewNote = body.data.reviewNote

    const fromState = recovery.state
    assertTransition(recovery.state, "approved")
    recovery.state = "approved"

    recovery.auditLog.push({
      fromState,
      toState: "approved",
      actor: user._id.toString(),
      actorType: "admin",
      reason: `Admin high-risk review completed`,
      timestamp: new Date(),
    })

    await recovery.save()

    const owner = await User.findById(recovery.userId).select("email phoneNumber")
    const channels: string[] = []
    if (owner?.email) channels.push(owner.email)
    if (owner?.phoneNumber) channels.push(owner.phoneNumber)
    void sendRecoveryNotifications("recovery_approved", recovery, channels)

    return NextResponse.json({ state: recovery.state })
  } catch (error) {
    console.error("RECOVERY_APPROVE_ERROR", error)
    return NextResponse.json({ message: "Unable to approve recovery." }, { status: 500 })
  }
}
