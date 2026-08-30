/**
 * Recent-authentication guard for high-risk actions.
 *
 * Checks whether the current session was established (or last refreshed) within
 * the required window. Routes that change a user's role, link/replace a Stellar
 * account, approve KYC decisions, or trigger payouts should gate behind this.
 *
 * Usage:
 *   const check = requireRecentAuth(session);
 *   if (!check.ok) return recentAuthRequired();
 */

import { NextResponse } from "next/server"
import type { SessionPayload } from "@/lib/auth/session"

/** Default window for standard high-risk actions (5 minutes). */
export const RECENT_AUTH_DEFAULT_MAX_AGE_SECONDS = 5 * 60

/** Tighter window for critical actions (stellar wallet replacement, role escalation). */
export const RECENT_AUTH_CRITICAL_MAX_AGE_SECONDS = 2 * 60

export interface RecentAuthResult {
  ok: boolean
  /** Seconds since the session was issued (negative means clock skew / unknown). */
  sessionAgeSeconds: number
  /** The configured maximum age in seconds. */
  maxAgeSeconds: number
}

/**
 * Checks whether the session was issued within `maxAgeSeconds`.
 * The session `iat` claim (issued-at) acts as the authentication timestamp.
 */
export function requireRecentAuth(
  session: Pick<SessionPayload, "iat">,
  maxAgeSeconds = RECENT_AUTH_DEFAULT_MAX_AGE_SECONDS,
): RecentAuthResult {
  const iat = typeof session.iat === "number" ? session.iat : null
  if (iat === null) {
    return { ok: false, sessionAgeSeconds: -1, maxAgeSeconds }
  }

  const sessionAgeSeconds = Math.floor(Date.now() / 1_000) - iat
  return {
    ok: sessionAgeSeconds <= maxAgeSeconds,
    sessionAgeSeconds,
    maxAgeSeconds,
  }
}

/**
 * Standard 401 response for routes that require re-authentication.
 * Does not reveal whether the session itself is valid.
 */
export function recentAuthRequired(): NextResponse {
  return NextResponse.json(
    {
      message: "This action requires recent authentication. Please sign in again to continue.",
      code: "RECENT_AUTH_REQUIRED",
    },
    { status: 401 },
  )
}
