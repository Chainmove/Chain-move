/**
 * GET /api/recovery/[id]
 *
 * Returns the current state of a recovery request (redacted for safety).
 * Only the owning user or an admin may view the record.
 */

import { NextResponse } from "next/server"
import dbConnect from "@/lib/dbConnect"
import WalletRecovery from "@/models/WalletRecovery"
import { getAuthenticatedUser } from "@/lib/auth/current-user"
import { getUnverifiedFactors } from "@/lib/recovery/recovery-factors"

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect()
    const { id } = await params

    const { user } = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const recovery = await WalletRecovery.findById(id)
    if (!recovery) return NextResponse.json({ message: "Recovery request not found." }, { status: 404 })

    const isOwner = recovery.userId === user._id.toString()
    const isAdmin = user.role === "admin"

    if (!isOwner && !isAdmin) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    const unverifiedFactors = getUnverifiedFactors(recovery.factors)

    return NextResponse.json({
      id: recovery._id.toString(),
      state: recovery.state,
      network: recovery.network,
      oldWalletAddress: recovery.oldWalletAddress,
      newWalletAddress: recovery.newWalletAddress,
      reason: recovery.reason,
      expiresAt: recovery.expiresAt,
      coolingOffEndsAt: recovery.coolingOffEndsAt,
      factors: recovery.factors.map((f) => ({ type: f.type, verified: f.verified, verifiedAt: f.verifiedAt })),
      unverifiedFactors,
      auditLog: recovery.auditLog.map((entry) => ({
        fromState: entry.fromState,
        toState: entry.toState,
        actorType: entry.actorType,
        reason: entry.reason,
        redactedEvidence: entry.redactedEvidence,
        timestamp: entry.timestamp,
      })),
      createdAt: recovery.createdAt,
      updatedAt: recovery.updatedAt,
    })
  } catch (error) {
    console.error("RECOVERY_GET_ERROR", error)
    return NextResponse.json({ message: "Unable to fetch recovery request." }, { status: 500 })
  }
}
