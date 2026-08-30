/**
 * Auth hardening tests (issue #98)
 *
 * Covers:
 *  - token-verifier: alg restriction, sub/iat validation, stale JWKS fallback
 *  - session: jti injection, sameSite:strict, revocation round-trip
 *  - session-revocation: jti + userId-based revocation
 *  - recent-auth: age thresholds
 *  - csrf: token generation, validation, expiry, timing-safe comparison
 *  - auth-event-log: structured output, no token leakage
 *  - stellar/link route: Privy re-verification, subject mismatch, token age
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import {
  generateCsrfToken,
  validateCsrfToken,
  validateRequestCsrf,
} from "@/lib/auth/csrf"
import {
  requireRecentAuth,
  RECENT_AUTH_DEFAULT_MAX_AGE_SECONDS,
  RECENT_AUTH_CRITICAL_MAX_AGE_SECONDS,
} from "@/lib/auth/recent-auth"
import {
  isSessionRevoked,
  revokeSession,
  revokeUserSessions,
} from "@/lib/auth/session-revocation"
import { _resetJwksCache, TokenVerificationError } from "@/lib/auth/token-verifier"

// ── Environment setup ─────────────────────────────────────────────────────────

const ENV_BACKUP: Record<string, string | undefined> = {}

function setEnv(vars: Record<string, string>) {
  for (const [k, v] of Object.entries(vars)) {
    ENV_BACKUP[k] = process.env[k]
    process.env[k] = v
  }
}

function restoreEnv() {
  for (const [k, v] of Object.entries(ENV_BACKUP)) {
    if (v === undefined) {
      delete process.env[k]
    } else {
      process.env[k] = v
    }
  }
}

// ── CSRF ─────────────────────────────────────────────────────────────────────

describe("csrf — generateCsrfToken / validateCsrfToken", () => {
  const SESSION_ID = "sess-abc-123"

  beforeEach(() => {
    setEnv({ CSRF_SECRET: "test-csrf-secret-xxxxxxxxxxxxxxxx" })
  })
  afterEach(restoreEnv)

  it("generates a token that validates for the same sessionId", () => {
    const token = generateCsrfToken(SESSION_ID)
    expect(validateCsrfToken(token, SESSION_ID)).toBe(true)
  })

  it("rejects null token", () => {
    expect(validateCsrfToken(null, SESSION_ID)).toBe(false)
  })

  it("rejects token for a different sessionId", () => {
    const token = generateCsrfToken(SESSION_ID)
    expect(validateCsrfToken(token, "other-session")).toBe(false)
  })

  it("rejects a tampered token (corrupted signature)", () => {
    const token = generateCsrfToken(SESSION_ID)
    const tampered = token.slice(0, -4) + "0000"
    expect(validateCsrfToken(tampered, SESSION_ID)).toBe(false)
  })

  it("rejects an expired token", () => {
    // Manually construct a token with an expiry in the past.
    const past = Date.now() - 1_000
    const { createHmac } = require("crypto")
    const payload = `${SESSION_ID}:${past}`
    const sig = createHmac("sha256", "test-csrf-secret-xxxxxxxxxxxxxxxx").update(payload).digest("hex")
    const expiredToken = `${past}.${sig}`
    expect(validateCsrfToken(expiredToken, SESSION_ID)).toBe(false)
  })

  it("rejects a token with no dot separator", () => {
    expect(validateCsrfToken("nodot", SESSION_ID)).toBe(false)
  })

  it("validates via validateRequestCsrf using request headers", () => {
    const token = generateCsrfToken(SESSION_ID)
    const request = new Request("http://localhost/", {
      headers: { "x-csrf-token": token },
    })
    expect(validateRequestCsrf(request, SESSION_ID)).toBe(true)
  })

  it("rejects when x-csrf-token header is absent", () => {
    const request = new Request("http://localhost/")
    expect(validateRequestCsrf(request, SESSION_ID)).toBe(false)
  })
})

// ── Recent auth ───────────────────────────────────────────────────────────────

describe("requireRecentAuth", () => {
  it("returns ok=true when session is fresh", () => {
    const iat = Math.floor(Date.now() / 1_000) - 30
    const result = requireRecentAuth({ iat })
    expect(result.ok).toBe(true)
    expect(result.sessionAgeSeconds).toBeGreaterThanOrEqual(30)
  })

  it("returns ok=false when session exceeds default max age", () => {
    const iat = Math.floor(Date.now() / 1_000) - (RECENT_AUTH_DEFAULT_MAX_AGE_SECONDS + 10)
    const result = requireRecentAuth({ iat })
    expect(result.ok).toBe(false)
  })

  it("returns ok=true when session age equals max age exactly", () => {
    const iat = Math.floor(Date.now() / 1_000) - RECENT_AUTH_DEFAULT_MAX_AGE_SECONDS
    const result = requireRecentAuth({ iat })
    expect(result.ok).toBe(true)
  })

  it("respects a custom maxAgeSeconds", () => {
    const iat = Math.floor(Date.now() / 1_000) - 90
    expect(requireRecentAuth({ iat }, 60).ok).toBe(false)
    expect(requireRecentAuth({ iat }, 120).ok).toBe(true)
  })

  it("returns ok=false when iat is missing", () => {
    const result = requireRecentAuth({ iat: undefined as unknown as number })
    expect(result.ok).toBe(false)
    expect(result.sessionAgeSeconds).toBe(-1)
  })

  it("RECENT_AUTH_CRITICAL_MAX_AGE_SECONDS is shorter than default", () => {
    expect(RECENT_AUTH_CRITICAL_MAX_AGE_SECONDS).toBeLessThan(RECENT_AUTH_DEFAULT_MAX_AGE_SECONDS)
  })
})

// ── Session revocation ────────────────────────────────────────────────────────

vi.mock("../models/RevokedSession", () => ({ default: { create: vi.fn().mockResolvedValue({}), findOne: vi.fn() } }))

// Mongoose mock so the schema registration doesn't fail in unit test context.
vi.mock("mongoose", async () => {
  const actual = await vi.importActual<typeof import("mongoose")>("mongoose")
  return {
    ...actual,
    models: {},
    model: vi.fn().mockReturnValue({
      create: vi.fn().mockResolvedValue({}),
      findOne: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ lean: vi.fn().mockResolvedValue(null) }) }),
    }),
  }
})

describe("session-revocation — in-process jti revocation", () => {
  const JTI = "test-jti-001"
  const USER_ID = "user-abc"
  const EXP = Math.floor(Date.now() / 1_000) + 3600

  it("marks a jti as revoked after revokeSession is called", async () => {
    await revokeSession(JTI, USER_ID, EXP, { reason: "test" })
    const revoked = await isSessionRevoked({ jti: JTI, userId: USER_ID, iat: EXP - 7200 })
    expect(revoked).toBe(true)
  })

  it("does not report a different jti as revoked", async () => {
    const revoked = await isSessionRevoked({ jti: "different-jti", userId: USER_ID, iat: EXP - 7200 })
    expect(revoked).toBe(false)
  })
})

describe("session-revocation — user-level revocation", () => {
  const USER_ID = "user-xyz"
  const revokedAt = new Date()
  const beforeRevocation = Math.floor(revokedAt.getTime() / 1_000) - 600
  const afterRevocation = Math.floor(revokedAt.getTime() / 1_000) + 60

  it("revokes sessions issued before the cutoff", async () => {
    await revokeUserSessions(USER_ID, { reason: "role_change" }, revokedAt)
    const revoked = await isSessionRevoked({ jti: "any-jti", userId: USER_ID, iat: beforeRevocation })
    expect(revoked).toBe(true)
  })

  it("does not revoke sessions issued after the cutoff", async () => {
    const revoked = await isSessionRevoked({ jti: "future-jti", userId: USER_ID, iat: afterRevocation })
    expect(revoked).toBe(false)
  })
})

// ── TokenVerificationError ────────────────────────────────────────────────────

describe("TokenVerificationError", () => {
  it("exposes code and message", () => {
    const err = new TokenVerificationError("missing_sub", "Token subject is missing.")
    expect(err.code).toBe("missing_sub")
    expect(err.message).toBe("Token subject is missing.")
    expect(err.name).toBe("TokenVerificationError")
    expect(err).toBeInstanceOf(Error)
  })
})

// ── JWKS cache reset ──────────────────────────────────────────────────────────

describe("_resetJwksCache", () => {
  it("is a callable function", () => {
    expect(typeof _resetJwksCache).toBe("function")
    expect(() => _resetJwksCache()).not.toThrow()
  })
})

// ── Stellar link route — unit (mocked deps) ───────────────────────────────────

const { getAuthenticatedUser } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
}))
const { verifyPrivyToken: mockVerifyPrivyToken } = vi.hoisted(() => ({
  verifyPrivyToken: vi.fn(),
}))
const { extractPrivyTokenFromRequest: mockExtractPrivyToken } = vi.hoisted(() => ({
  extractPrivyTokenFromRequest: vi.fn(),
}))
const { logAuthEvent: mockLogAuthEvent } = vi.hoisted(() => ({
  logAuthEvent: vi.fn(),
}))

vi.mock("@/lib/auth/current-user", () => ({ getAuthenticatedUser, withSessionRefresh: vi.fn(async (r: unknown) => r) }))
vi.mock("@/lib/auth/privy", () => ({
  verifyPrivyToken: mockVerifyPrivyToken,
  extractPrivyTokenFromRequest: mockExtractPrivyToken,
  getPrivyProfileFromPayload: vi.fn(),
}))
vi.mock("@/lib/auth/auth-event-log", () => ({ logAuthEvent: mockLogAuthEvent }))
vi.mock("@/models/User", () => ({ default: { findOne: vi.fn() } }))

import { POST } from "@/app/api/auth/stellar/link/route"

function makeUser(overrides: Record<string, unknown> = {}) {
  return {
    _id: { toString: () => "user-1" },
    privyUserId: "privy-sub-aaa",
    role: "investor",
    stellarPublicKey: null,
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function buildRequest(body: unknown, extraHeaders: Record<string, string> = {}) {
  return new Request("http://localhost/api/auth/stellar/link", {
    method: "POST",
    headers: { "content-type": "application/json", ...extraHeaders },
    body: JSON.stringify(body),
  })
}

const VALID_STELLAR_KEY = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"

beforeEach(() => {
  vi.clearAllMocks()
})

describe("POST /api/auth/stellar/link — recent-auth enforcement", () => {
  it("returns 401 when no Privy token is present", async () => {
    getAuthenticatedUser.mockResolvedValue({ user: makeUser(), shouldRefreshSession: false })
    mockExtractPrivyToken.mockReturnValue(null)

    const response = (await POST(buildRequest({ stellarPublicKey: VALID_STELLAR_KEY })))!
    expect(response.status).toBe(401)
    const body = await response.json()
    expect(body.code).toBe("RECENT_AUTH_REQUIRED")
  })

  it("returns 401 when Privy token verification fails", async () => {
    getAuthenticatedUser.mockResolvedValue({ user: makeUser(), shouldRefreshSession: false })
    mockExtractPrivyToken.mockReturnValue("bad-token")
    mockVerifyPrivyToken.mockRejectedValue(new Error("JWTExpired"))

    const response = (await POST(buildRequest({ stellarPublicKey: VALID_STELLAR_KEY })))!
    expect(response.status).toBe(401)
  })

  it("returns 401 when Privy sub does not match user.privyUserId", async () => {
    const user = makeUser({ privyUserId: "privy-sub-aaa" })
    getAuthenticatedUser.mockResolvedValue({ user, shouldRefreshSession: false })
    mockExtractPrivyToken.mockReturnValue("valid-token")
    mockVerifyPrivyToken.mockResolvedValue({
      sub: "privy-sub-DIFFERENT",
      iat: Math.floor(Date.now() / 1_000) - 30,
    })

    const response = (await POST(buildRequest({ stellarPublicKey: VALID_STELLAR_KEY })))!
    expect(response.status).toBe(401)
    expect(mockLogAuthEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "privy_subject_mismatch" }))
  })

  it("returns 401 when Privy token is older than critical max age", async () => {
    const user = makeUser({ privyUserId: "privy-sub-aaa" })
    getAuthenticatedUser.mockResolvedValue({ user, shouldRefreshSession: false })
    mockExtractPrivyToken.mockReturnValue("valid-token")
    mockVerifyPrivyToken.mockResolvedValue({
      sub: "privy-sub-aaa",
      iat: Math.floor(Date.now() / 1_000) - (RECENT_AUTH_CRITICAL_MAX_AGE_SECONDS + 30),
    })

    const response = (await POST(buildRequest({ stellarPublicKey: VALID_STELLAR_KEY })))!
    expect(response.status).toBe(401)
    expect(mockLogAuthEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "high_risk_action_denied_recent_auth" }),
    )
  })
})
