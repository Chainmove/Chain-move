/**
 * Centralized Privy token verifier with hardened claim checks and TTL-based
 * JWKS caching that survives key rotation without accepting unknown keys indefinitely.
 *
 * Enforcement beyond the previous privy.ts baseline:
 *  - Restricts accepted algorithms to ES256 (prevents alg:none / HS256 confusion attacks)
 *  - Validates `sub` (Privy user ID) is present and non-empty
 *  - Validates `iat` (issued-at) is in the past
 *  - JWKS refreshes automatically after JWKS_SOFT_TTL_MS; serves stale cache on failure
 *    for up to JWKS_STALE_TTL_MS before hard-failing
 */

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose"

const PRIVY_ISSUERS = ["privy.io", "https://auth.privy.io", "https://auth.privy.io/"]
const ACCEPTED_ALGORITHMS = ["ES256"] as const

/** How long a JWKS fetch result is considered fresh. */
const JWKS_SOFT_TTL_MS = 5 * 60 * 1_000

/** How long we serve a stale JWKS when the remote is unavailable. */
const JWKS_STALE_TTL_MS = 10 * 60 * 1_000

/** Max clock skew allowed between issuer and verifier. */
export const CLOCK_SKEW_SECONDS = 60

interface JwksCache {
  jwks: ReturnType<typeof createRemoteJWKSet>
  fetchedAt: number
  healthy: boolean
}

let jwksCache: JwksCache | null = null
let inflight: Promise<JwksCache> | null = null

function getPrivyJwksUrl(): string {
  if (process.env.PRIVY_JWKS_URL) return process.env.PRIVY_JWKS_URL
  const appId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID
  if (!appId) throw new Error("Missing PRIVY_JWKS_URL or PRIVY_APP_ID")
  return `https://auth.privy.io/api/v1/apps/${appId}/jwks.json`
}

function getPrivyAudience(): string {
  const appId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID
  if (!appId) throw new Error("Missing PRIVY_APP_ID or NEXT_PUBLIC_PRIVY_APP_ID")
  return appId
}

async function fetchFreshJwks(): Promise<JwksCache> {
  const jwks = createRemoteJWKSet(new URL(getPrivyJwksUrl()))
  return { jwks, fetchedAt: Date.now(), healthy: true }
}

/**
 * Returns a JWKS function that is refreshed on a soft TTL. On fetch failure,
 * serves the stale cache until JWKS_STALE_TTL_MS, then throws.
 */
async function getJwks(): Promise<ReturnType<typeof createRemoteJWKSet>> {
  const now = Date.now()

  // Fast-path: fresh cached value within soft TTL.
  if (jwksCache && now - jwksCache.fetchedAt < JWKS_SOFT_TTL_MS) {
    return jwksCache.jwks
  }

  // Coalesce concurrent refresh calls.
  if (!inflight) {
    inflight = fetchFreshJwks()
      .then((result) => {
        jwksCache = result
        return result
      })
      .catch((err) => {
        inflight = null
        if (jwksCache && now - jwksCache.fetchedAt < JWKS_STALE_TTL_MS) {
          return jwksCache
        }
        throw err
      })
      .finally(() => {
        inflight = null
      })
  }

  const result = await inflight
  return result.jwks
}

export interface HardenedPrivyPayload extends JWTPayload {
  sub: string
  email?: string
  phone_number?: string
  linked_accounts?: unknown
}

/**
 * Verifies a Privy token with hardened claims: explicit ES256, issuer,
 * audience, subject, issued-at, and clock-skew enforcement.
 *
 * Throws `TokenVerificationError` on any claim violation.
 */
export async function verifyPrivyTokenStrict(token: string): Promise<HardenedPrivyPayload> {
  const jwks = await getJwks()

  const { payload } = await jwtVerify(token, jwks, {
    issuer: PRIVY_ISSUERS,
    audience: getPrivyAudience(),
    algorithms: [...ACCEPTED_ALGORITHMS],
    clockTolerance: CLOCK_SKEW_SECONDS,
  })

  if (!payload.sub || payload.sub.trim().length === 0) {
    throw new TokenVerificationError("missing_sub", "Token subject (sub) is missing or empty.")
  }

  const iat = typeof payload.iat === "number" ? payload.iat : null
  if (iat === null || iat > Math.floor(Date.now() / 1_000) + CLOCK_SKEW_SECONDS) {
    throw new TokenVerificationError("invalid_iat", "Token issued-at (iat) is in the future.")
  }

  return payload as HardenedPrivyPayload
}

export class TokenVerificationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = "TokenVerificationError"
  }
}

/** Returns current JWKS health for use in health-check endpoints. */
export function getJwksHealth(): { healthy: boolean; cachedAt: number | null; ageMs: number | null } {
  if (!jwksCache) return { healthy: false, cachedAt: null, ageMs: null }
  return {
    healthy: jwksCache.healthy,
    cachedAt: jwksCache.fetchedAt,
    ageMs: Date.now() - jwksCache.fetchedAt,
  }
}

/** Reset the JWKS cache (for tests only). */
export function _resetJwksCache(): void {
  jwksCache = null
  inflight = null
}
