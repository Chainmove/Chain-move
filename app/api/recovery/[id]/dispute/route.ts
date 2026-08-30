/**
 * POST /api/recovery/[id]/dispute
 *
 * Allows a third party (or the account holder using the old wallet) to
 * dispute an in-progress recovery. Disputes are accepted during cooling_off
 * or approved states and immediately halt the flow pending manual review.
 */

import { NextResponse } from "next/server"
import { z } from "zod"
import dbConnect from "@/lib/dbConnect"
import WalletRecovery from "@/models/WalletRecovery"
import { getAuthenticatedUser } from "@/lib/auth/current-user"
import { parseJsonBody } from "@/lib/api/validation"
import { assertTransition, isTerminal } from "@/lib/recovery/recovery-state-machine"
import { sendRecoveryNotifications } from "@/lib/recovery/recovery-notifications"
import User from "@/models/User"

const bodySchema = z.object({
  reason: z.string().trim().min(10).max(2000),
  evidence: z.string().trim().max(5000).optional(),
})

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect()
    const { id } = await params

    const { user } = await getAuthenticatedUser(request)
    const body = await parseJsonBody(request, bodySchema)
    if ("response" in body) return body.response

    const recovery = await WalletRecovery.findById(id)
    if (!recovery) return NextResponse.json({ message: "Recovery request not found." }, { status: 404 })

    if (isTerminal(recovery.state)) {
      return NextResponse.json({ message: `Recovery is already ${recovery.state}.` }, { status: 409 })
    }

    if (recovery.state !== "cooling_off" && recovery.state !== "approved") {
      return NextResponse.json(
        { message: "Disputes can only be filed during cooling_off or approved states." },
        { status: 409 },
      )
    }

    const actorId = user ? user._id.toString() : "anonymous"
    const actorType = user?.role === "admin" ? "admin" : "user"
    const fromState = recovery.state

    assertTransition(recovery.state, "disputed")
    recovery.state = "disputed"
    recovery.disputedAt = new Date()
    recovery.disputeReason = body.data.reason
    recovery.auditLog.push({
      fromState,
      toState: "disputed",
      actor: actorId,
      actorType,
      reason: body.data.reason,
      redactedEvidence: Boolean(body.data.evidence),
      timestamp: new Date(),
    })

    await recovery.save()

    const owner = await User.findById(recovery.userId).select("email phoneNumber")
    const channels: string[] = []
    if (owner?.email) channels.push(owner.email)
    if (owner?.phoneNumber) channels.push(owner.phoneNumber)
    void sendRecoveryNotifications("recovery_disputed", recovery, channels)

    return NextResponse.json({ state: recovery.state, disputedAt: recovery.disputedAt })
  } catch (error) {
    console.error("RECOVERY_DISPUTE_ERROR", error)
    return NextResponse.json({ message: "Unable to file dispute." }, { status: 500 })
  }
}
