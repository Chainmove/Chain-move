/**
 * POST /api/recovery/[id]/execute
 *
 * Executes an approved recovery: rebinds the user's Stellar (or other network)
 * wallet reference, creates an immutable WalletMigrationRecord, unfreezes
 * high-risk actions, and notifies all channels.
 *
 * Historical transactions remain attributable to the old wallet; only the live
 * stellarPublicKey / walletAddress fields on the User document are updated.
 */

import { NextResponse } from "next/server"
import dbConnect from "@/lib/dbConnect"
import WalletRecovery from "@/models/WalletRecovery"
import WalletMigrationRecord from "@/models/WalletMigrationRecord"
import User from "@/models/User"
import { getAuthenticatedUser } from "@/lib/auth/current-user"
import { assertTransition, isTerminal } from "@/lib/recovery/recovery-state-machine"
import { allFactorsVerified } from "@/lib/recovery/recovery-factors"
import { sendRecoveryNotifications } from "@/lib/recovery/recovery-notifications"

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    await dbConnect()
    const { id } = await params

    const { user } = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const recovery = await WalletRecovery.findById(id)
    if (!recovery) return NextResponse.json({ message: "Recovery request not found." }, { status: 404 })

    const isOwner = recovery.userId === user._id.toString()
    const isAdmin = user.role === "admin"
    if (!isOwner && !isAdmin) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    if (isTerminal(recovery.state)) {
      return NextResponse.json({ message: `Recovery is already ${recovery.state}.` }, { status: 409 })
    }

    if (recovery.state !== "approved") {
      return NextResponse.json(
        { message: "Recovery must be approved before execution." },
        { status: 409 },
      )
    }

    if (!allFactorsVerified(recovery.factors)) {
      return NextResponse.json({ message: "Not all verification factors have been satisfied." }, { status: 409 })
    }

    if (new Date() > recovery.expiresAt) {
      return NextResponse.json({ message: "Recovery request has expired." }, { status: 410 })
    }

    // Perform the wallet rebind on the User document.
    const owner = await User.findById(recovery.userId)
    if (!owner) return NextResponse.json({ message: "User not found." }, { status: 404 })

    if (recovery.network === "stellar") {
      owner.stellarPublicKey = recovery.newWalletAddress
      // Do not overwrite stellarLinkedAt — preserve original link timestamp.
    } else {
      owner.walletAddress = recovery.newWalletAddress
      owner.walletaddress = recovery.newWalletAddress
    }

    await owner.save()

    // Create the immutable migration record.
    await WalletMigrationRecord.create({
      userId: recovery.userId,
      recoveryId: recovery._id.toString(),
      network: recovery.network,
      oldWalletAddress: recovery.oldWalletAddress,
      newWalletAddress: recovery.newWalletAddress,
      migratedAt: new Date(),
      authorisedBy: [
        recovery.userId,
        ...(recovery.highRiskReviewerId ? [recovery.highRiskReviewerId] : []),
      ],
    })

    const fromState = recovery.state
    assertTransition(recovery.state, "executed")
    recovery.state = "executed"
    recovery.executedAt = new Date()
    recovery.unfrozenAt = new Date()
    recovery.auditLog.push({
      fromState,
      toState: "executed",
      actor: user._id.toString(),
      actorType: isAdmin ? "admin" : "user",
      reason: "Wallet rebind executed",
      timestamp: new Date(),
    })

    await recovery.save()

    const channels: string[] = []
    if (owner.email) channels.push(owner.email)
    if (owner.phoneNumber) channels.push(owner.phoneNumber)
    void sendRecoveryNotifications("recovery_executed", recovery, channels)

    return NextResponse.json({
      state: recovery.state,
      executedAt: recovery.executedAt,
      newWalletAddress: recovery.newWalletAddress,
      migrationRecordCreated: true,
    })
  } catch (error) {
    console.error("RECOVERY_EXECUTE_ERROR", error)
    return NextResponse.json({ message: "Unable to execute recovery." }, { status: 500 })
  }
}
