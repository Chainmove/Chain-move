import { NextResponse } from "next/server"
import { z } from "zod"
import User from "@/models/User"
import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { extractPrivyTokenFromRequest, getPrivyProfileFromPayload, verifyPrivyToken } from "@/lib/auth/privy"
import { parseJsonBody } from "@/lib/api/validation"
import { toUserProfileSnapshot } from "@/lib/users/user-profile"
import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"
import { requireRecentAuth, recentAuthRequired, RECENT_AUTH_CRITICAL_MAX_AGE_SECONDS } from "@/lib/auth/recent-auth"
import { logAuthEvent } from "@/lib/auth/auth-event-log"

const bodySchema = z.object({
  stellarPublicKey: z.string().trim().min(1, "Stellar public account is required."),
})

function isDuplicateKeyError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === 11000
  )
}

export async function POST(request: Request) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    // Stellar linking is a high-risk account mutation: require a Privy token
    // issued in the last RECENT_AUTH_CRITICAL_MAX_AGE_SECONDS (2 minutes).
    // This ensures the user is actively authenticated, not just holding a stale session.
    const privyToken = extractPrivyTokenFromRequest(request)
    if (!privyToken) {
      logAuthEvent({
        type: "high_risk_action_denied_recent_auth",
        userId: user._id.toString(),
        detail: "stellar_link: missing privy token",
        request,
      })
      return recentAuthRequired()
    }

    let privyPayload: Awaited<ReturnType<typeof verifyPrivyToken>>
    try {
      privyPayload = await verifyPrivyToken(privyToken)
    } catch {
      logAuthEvent({
        type: "token_invalid",
        userId: user._id.toString(),
        detail: "stellar_link: privy token verification failed",
        request,
      })
      return recentAuthRequired()
    }

    // Verify the Privy subject matches the authenticated user (prevents token substitution).
    if (user.privyUserId && privyPayload.sub !== user.privyUserId) {
      logAuthEvent({
        type: "privy_subject_mismatch",
        userId: user._id.toString(),
        privyUserId: privyPayload.sub,
        detail: "stellar_link: privy sub does not match user.privyUserId",
        request,
      })
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    // Validate the token was issued recently enough for this high-risk action.
    const iat = typeof privyPayload.iat === "number" ? privyPayload.iat : 0
    const tokenAgeSeconds = Math.floor(Date.now() / 1_000) - iat
    if (tokenAgeSeconds > RECENT_AUTH_CRITICAL_MAX_AGE_SECONDS) {
      logAuthEvent({
        type: "high_risk_action_denied_recent_auth",
        userId: user._id.toString(),
        detail: `stellar_link: privy token age ${tokenAgeSeconds}s exceeds ${RECENT_AUTH_CRITICAL_MAX_AGE_SECONDS}s`,
        request,
      })
      return recentAuthRequired()
    }

    const body = await parseJsonBody(request, bodySchema)
    if ("response" in body) return body.response

    const stellarPublicKey = normalizeStellarPublicKey(body.data.stellarPublicKey)
    if (!isValidStellarPublicKey(stellarPublicKey)) {
      return NextResponse.json({ message: "Invalid Stellar public account." }, { status: 400 })
    }

    const existingOwner = await User.findOne({ stellarPublicKey }).select("_id")
    if (existingOwner && existingOwner._id.toString() !== user._id.toString()) {
      logAuthEvent({
        type: "stellar_link_cross_account",
        userId: user._id.toString(),
        detail: `stellar_link: key already owned by another user`,
        request,
      })
      return NextResponse.json(
        { message: "This Stellar account is already linked to another user." },
        { status: 409 },
      )
    }

    const isFirstLink = !user.stellarPublicKey
    user.stellarPublicKey = stellarPublicKey
    if (isFirstLink) {
      user.stellarLinkedAt = new Date()
    }

    try {
      await user.save()
    } catch (saveError) {
      if (isDuplicateKeyError(saveError)) {
        return NextResponse.json(
          { message: "This Stellar account is already linked to another user." },
          { status: 409 },
        )
      }
      throw saveError
    }

    logAuthEvent({
      type: "stellar_linked",
      userId: user._id.toString(),
      detail: `isFirstLink=${isFirstLink}`,
      request,
    })

    const response = NextResponse.json({ user: toUserProfileSnapshot(user) })
    if (shouldRefreshSession) {
      await withSessionRefresh(response, user)
    }
    return response
  } catch (error) {
    console.error("STELLAR_LINK_ERROR", error)
    return NextResponse.json({ message: "Unable to link Stellar account." }, { status: 500 })
  }
}
