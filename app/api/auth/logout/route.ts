import { NextResponse } from "next/server"
import { clearSessionCookie, getSessionFromCookies, SESSION_TTL_SECONDS } from "@/lib/auth/session"
import { revokeSession } from "@/lib/auth/session-revocation"
import { logAuthEvent } from "@/lib/auth/auth-event-log"

export async function POST(request: Request) {
  try {
    const session = await getSessionFromCookies()

    if (session?.jti && session?.userId) {
      const exp = typeof session.exp === "number" ? session.exp : Math.floor(Date.now() / 1_000) + SESSION_TTL_SECONDS
      await revokeSession(session.jti, session.userId, exp, {
        reason: "logout",
        sessionTtlSeconds: SESSION_TTL_SECONDS,
      })
      logAuthEvent({ type: "logout", userId: session.userId, request })
    }

    const response = NextResponse.json({ message: "Logout successful" }, { status: 200 })
    clearSessionCookie(response)
    return response
  } catch {
    return NextResponse.json({ message: "An error occurred during logout" }, { status: 500 })
  }
}
