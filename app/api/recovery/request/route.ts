/**
 * POST /api/recovery/request
 *
 * Initiates a new wallet recovery request.
 * Validates uniqueness of old/new wallet pair, enforces rate limits,
 * freezes high-risk actions, and sends initial notifications to all channels.
 */

import { NextResponse } from "next/server"
import { z } from "zod"
import { randomUUID } from "crypto"
import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import WalletRecovery from "@/models/WalletRecovery"
import { getAuthenticatedUser } from "@/lib/auth/current-user"
import { parseJsonBody } from "@/lib/api/validation"
import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"
import { buildInitialFactors } from "@/lib/recovery/recovery-factors"
import { checkRecoveryRateLimits } from "@/lib/recovery/recovery-rate-limit"
import { recoveryExpiresAt } from "@/lib/recovery/recovery-state-machine"
import { sendRecoveryNotifications } from "@/lib/recovery/recovery-notifications"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"

const bodySchema = z.object({
  network: z.enum(["stellar", "evm", "embedded"]),
  oldWalletAddress: z.string().trim().min(1),
  newWalletAddress: z.string().trim().min(1),
  reason: z.string().trim().min(10).max(1000),
})

export async function POST(request: Request) {
  try {
    await dbConnect()

    // IP-level rate limit: 10 requests per day.
    const ipRateLimit = consumeRateLimit({
      key: buildRateLimitKey("recovery-request", getClientIpAddress(request)),
      limit: 10,
      windowMs: 24 * 60 * 60 * 1_000,
    })
    if (!ipRateLimit.allowed) return rateLimitExceededResponse(ipRateLimit)

    const { user } = await getAuthenticatedUser(request)
    if (!user) return NextResponse.json({ message: "Unauthorized" }, { status: 401 })

    const body = await parseJsonBody(request, bodySchema)
    if ("response" in body) return body.response

    const { network, reason } = body.data
    let oldWalletAddress = body.data.oldWalletAddress.trim()
    let newWalletAddress = body.data.newWalletAddress.trim()

    if (network === "stellar") {
      oldWalletAddress = normalizeStellarPublicKey(oldWalletAddress)
      newWalletAddress = normalizeStellarPublicKey(newWalletAddress)
      if (!isValidStellarPublicKey(oldWalletAddress) || !isValidStellarPublicKey(newWalletAddress)) {
        return NextResponse.json({ message: "Invalid Stellar public account." }, { status: 400 })
      }
    }

    if (oldWalletAddress === newWalletAddress) {
      return NextResponse.json({ message: "Old and new wallet addresses must be different." }, { status: 400 })
    }

    // Verify old wallet is actually linked to this user.
    const ownsOldWallet =
      user.stellarPublicKey === oldWalletAddress ||
      user.walletAddress === oldWalletAddress ||
      user.walletaddress === oldWalletAddress

    if (!ownsOldWallet) {
      return NextResponse.json({ message: "Old wallet address is not linked to your account." }, { status: 400 })
    }

    // New wallet must not already be owned by another user.
    const newWalletOwner = await User.findOne({
      $or: [{ stellarPublicKey: newWalletAddress }, { walletAddress: newWalletAddress }],
    }).select("_id")

    if (newWalletOwner && newWalletOwner._id.toString() !== user._id.toString()) {
      return NextResponse.json({ message: "New wallet address is already linked to another account." }, { status: 409 })
    }

    const rateCheck = await checkRecoveryRateLimits({ userId: user._id.toString(), newWalletAddress })
    if (!rateCheck.allowed) {
      return NextResponse.json({ message: rateCheck.reason }, { status: 429 })
    }

    const nonce = randomUUID()
    const expiresAt = recoveryExpiresAt()

    const recovery = await WalletRecovery.create({
      userId: user._id.toString(),
      network,
      oldWalletAddress,
      newWalletAddress,
      reason,
      nonce,
      expiresAt,
      state: "requested",
      factors: buildInitialFactors(),
      frozenAt: new Date(),
      auditLog: [
        {
          fromState: null,
          toState: "requested",
          actor: user._id.toString(),
          actorType: "user",
          reason: "Recovery initiated",
          timestamp: new Date(),
        },
      ],
    })

    // Collect all contact channels for notifications (email, phone).
    const channels: string[] = []
    if (user.email) channels.push(user.email)
    if (user.phoneNumber) channels.push(user.phoneNumber)

    // Fire-and-forget notifications.
    void sendRecoveryNotifications("recovery_requested", recovery, channels)

    return NextResponse.json(
      {
        recoveryId: recovery._id.toString(),
        state: recovery.state,
        nonce: recovery.nonce,
        expiresAt: recovery.expiresAt,
        unverifiedFactors: ["session", "contact_channel", "guardian_key", "high_risk_review"],
        message: "Recovery request created. Complete all verification factors to proceed.",
      },
      { status: 201 },
    )
  } catch (error) {
    console.error("RECOVERY_REQUEST_ERROR", error)
    return NextResponse.json({ message: "Unable to create recovery request." }, { status: 500 })
  }
}
