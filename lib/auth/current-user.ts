import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import { extractPrivyTokenFromRequest, getPrivyProfileFromPayload, verifyPrivyToken } from "@/lib/auth/privy"
import { getSessionFromCookies, setSessionCookie, signSessionToken } from "@/lib/auth/session"
import { isSessionRevoked } from "@/lib/auth/session-revocation"
import { logAuthEvent } from "@/lib/auth/auth-event-log"
import { NextResponse } from "next/server"

export async function getAuthenticatedUser(request: Request) {
  await dbConnect()

  const session = await getSessionFromCookies()
  if (session?.userId && session?.jti) {
    // Reject revoked sessions before touching the DB for the user record.
    const revoked = await isSessionRevoked({
      jti: session.jti,
      userId: session.userId,
      iat: typeof session.iat === "number" ? session.iat : 0,
    })
    if (revoked) {
      logAuthEvent({ type: "session_revoked", userId: session.userId, request })
      return { user: null, shouldRefreshSession: false }
    }

    const user = await User.findById(session.userId)
    if (user) {
      // Reject stale role: if the DB role differs from the session role, force
      // re-authentication so the caller always has accurate permissions.
      if (user.role !== session.role) {
        logAuthEvent({
          type: "role_stale_rejected",
          userId: session.userId,
          detail: `session_role=${session.role} db_role=${user.role}`,
          request,
        })
        return { user: null, shouldRefreshSession: false }
      }
      return { user, shouldRefreshSession: false }
    }
  }

  const privyToken = extractPrivyTokenFromRequest(request)
  if (!privyToken) return { user: null, shouldRefreshSession: false }

  const privyPayload = await verifyPrivyToken(privyToken)
  const profile = getPrivyProfileFromPayload(privyPayload)

  const user = await User.findOne({
    $or: [{ privyUserId: profile.privyUserId }, ...(profile.email ? [{ email: profile.email.toLowerCase() }] : [])],
  })

  return { user, shouldRefreshSession: Boolean(user) }
}

export async function withSessionRefresh(response: NextResponse, user: any) {
  const sessionToken = await signSessionToken({
    userId: user._id.toString(),
    role: user.role,
    name: user.name,
    privyUserId: user.privyUserId,
  })
  setSessionCookie(response, sessionToken)
  return response
}
