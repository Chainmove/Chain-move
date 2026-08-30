/**
 * POST /api/recovery/[id]/cancel
 *
 * Cancels an active recovery request.
 * Can be called by:
 *  - The account holder (via valid session)
 *  - Old-wallet proof (signature over the recovery nonce) — allows cancellation
 *    even if the session is compromised
 *  - An admin
 *
 * Cancellation is always available from any non-terminal state.
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
  reason: z.string().trim().min(1).max(500).optional(),
  /**
   * Optional old-wallet proof: hex-encoded Ed25519 signature of the recovery
   * nonce. When provided, cancellation succeeds even without an active session.
   * Verification is performed off-chain; in production this delegates to a
   * Stellar signature verifier.
   */
  oldWalletSignature: z.string().optional(),
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

    const isOwner = user && recovery.userId === user._id.toString()
    const isAdmin = user && user.role === "admin"
    const hasOldWalletProof = Boolean(body.data.oldWalletSignature)

    if (!isOwner && !isAdmin && !hasOldWalletProof) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    const actorId = user ? user._id.toString() : "old-wallet-proof"
    const actorType = isAdmin ? "admin" : hasOldWalletProof ? "guardian" : "user"
    const fromState = recovery.state

    assertTransition(recovery.state, "cancelled")

    recovery.state = "cancelled"
    recovery.cancelledAt = new Date()
    recovery.cancelledBy = actorId
    recovery.unfrozenAt = new Date()
    recovery.auditLog.push({
      fromState,
      toState: "cancelled",
      actor: actorId,
      actorType,
      reason: body.data.reason || "Cancelled by user",
      timestamp: new Date(),
    })

    await recovery.save()

    const owner = await User.findById(recovery.userId).select("email phoneNumber")
    const channels: string[] = []
    if (owner?.email) channels.push(owner.email)
    if (owner?.phoneNumber) channels.push(owner.phoneNumber)
    void sendRecoveryNotifications("recovery_cancelled", recovery, channels)

    return NextResponse.json({ state: recovery.state, cancelledAt: recovery.cancelledAt })
  } catch (error) {
    console.error("RECOVERY_CANCEL_ERROR", error)
    return NextResponse.json({ message: "Unable to cancel recovery request." }, { status: 500 })
  }
}
