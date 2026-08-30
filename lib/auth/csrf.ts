/**
 * CSRF protection for cookie-based state-mutation routes.
 *
 * Uses a double-submit cookie pattern with HMAC-SHA-256:
 *  - Server generates a token = HMAC(secret, sessionId + timestamp)
 *  - Token is sent as a JSON response field on GET /api/auth/me and /api/auth/csrf-token
 *  - Client echoes it in the `x-csrf-token` header on POST/PUT/DELETE requests
 *  - Server validates the HMAC and rejects requests where it is absent or wrong
 *
 * This is defence-in-depth alongside `sameSite: "strict"` cookies. Routes that
 * are called from first-party JS should include the CSRF header; third-party
 * requests from other origins cannot read the token (SameSite + CORS) and
 * cannot forge the HMAC without the server secret.
 *
 * Stateless: no token storage needed; expiry is encoded in the token payload.
 */

import { createHmac, timingSafeEqual } from "crypto"

const CSRF_TTL_MS = 60 * 60 * 1_000 // 1 hour

function getCsrfSecret(): string {
  const secret = process.env.CSRF_SECRET || process.env.JWT_SECRET || process.env.AUTH_SESSION_SECRET
  if (!secret) throw new Error("CSRF_SECRET (or JWT_SECRET) is required for CSRF token generation.")
  return secret
}

function sign(payload: string): string {
  return createHmac("sha256", getCsrfSecret()).update(payload).digest("hex")
}

/**
 * Generates a CSRF token bound to `sessionId`.
 * The token encodes an expiry timestamp so stale tokens are rejected even if
 * the server secret has not changed.
 */
export function generateCsrfToken(sessionId: string): string {
  const expiresAt = Date.now() + CSRF_TTL_MS
  const payload = `${sessionId}:${expiresAt}`
  const sig = sign(payload)
  return `${expiresAt}.${sig}`
}

/**
 * Validates a CSRF token submitted in `x-csrf-token`.
 * Returns false if the token is missing, malformed, expired, or the HMAC is wrong.
 */
export function validateCsrfToken(token: string | null, sessionId: string): boolean {
  if (!token) return false

  const dotIndex = token.indexOf(".")
  if (dotIndex === -1) return false

  const expiresAtStr = token.slice(0, dotIndex)
  const sig = token.slice(dotIndex + 1)
  const expiresAt = Number(expiresAtStr)

  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) return false

  const payload = `${sessionId}:${expiresAt}`
  const expected = sign(payload)

  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"))
  } catch {
    return false
  }
}

/**
 * Extracts and validates the CSRF token from a Request.
 * Reads the `x-csrf-token` header and validates it against `sessionId`.
 */
export function validateRequestCsrf(request: Request, sessionId: string): boolean {
  const token = request.headers.get("x-csrf-token")
  return validateCsrfToken(token, sessionId)
}
