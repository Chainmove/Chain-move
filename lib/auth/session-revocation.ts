/**
 * Session revocation store.
 *
 * Provides two mechanisms:
 *  1. jti-based revocation — individual session tokens can be invalidated at
 *     logout or on suspected compromise (in-process + Mongoose-backed).
 *  2. userId-based "revoke all after" — all sessions issued before a given
 *     timestamp are treated as revoked (used when role changes, email changes,
 *     password resets, or suspected account compromise occur).
 *
 * The in-process store is used for fast rejection in the same process; the
 * DB-backed store survives restarts and propagates across multiple instances.
 */

import mongoose from "mongoose"

// ── Mongoose schema ───────────────────────────────────────────────────────────

interface IRevokedSession {
  jti?: string
  userId?: string
  revokedAfter?: Date
  reason: string
  revokedAt: Date
  expiresAt: Date
}

const RevokedSessionSchema = new mongoose.Schema<IRevokedSession>({
  jti: { type: String, index: true, sparse: true },
  userId: { type: String, index: true, sparse: true },
  revokedAfter: { type: Date },
  reason: { type: String, required: true },
  revokedAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true },
})

RevokedSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

const RevokedSession =
  (mongoose.models.RevokedSession as mongoose.Model<IRevokedSession>) ||
  mongoose.model<IRevokedSession>("RevokedSession", RevokedSessionSchema)

// ── In-process fast-path ──────────────────────────────────────────────────────

/** jti → expiry epoch */
const revokedJtis = new Map<string, number>()
/** userId → timestamp (sessions issued before this are revoked) */
const userRevokedAfter = new Map<string, number>()

function pruneExpiredJtis(): void {
  const now = Date.now() / 1_000
  for (const [jti, expiry] of revokedJtis) {
    if (expiry < now) revokedJtis.delete(jti)
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface RevocationOptions {
  reason: string
  /** Session TTL in seconds (used to set DB document expiry). Default: 7 days. */
  sessionTtlSeconds?: number
}

const DEFAULT_TTL = 60 * 60 * 24 * 7

/**
 * Revokes a specific session identified by its `jti` claim.
 * Call this on logout or on suspected token compromise.
 */
export async function revokeSession(
  jti: string,
  userId: string,
  exp: number,
  opts: RevocationOptions,
): Promise<void> {
  const ttl = opts.sessionTtlSeconds ?? DEFAULT_TTL
  const expiresAt = new Date(Date.now() + ttl * 1_000)

  revokedJtis.set(jti, exp)

  await RevokedSession.create({ jti, userId, reason: opts.reason, expiresAt }).catch(() => {})
}

/**
 * Revokes all sessions for a user issued before `revokedAfter` (defaults to now).
 * Use after role changes, email changes, password resets, or suspected compromise.
 */
export async function revokeUserSessions(
  userId: string,
  opts: RevocationOptions,
  revokedAfter?: Date,
): Promise<void> {
  const ts = revokedAfter ?? new Date()
  const ttl = opts.sessionTtlSeconds ?? DEFAULT_TTL

  userRevokedAfter.set(userId, ts.getTime())

  await RevokedSession.create({
    userId,
    revokedAfter: ts,
    reason: opts.reason,
    expiresAt: new Date(Date.now() + ttl * 1_000),
  }).catch(() => {})
}

/**
 * Returns true if the session (identified by jti and iat) should be rejected.
 * Checks in-process store first, then falls back to DB for cross-instance accuracy.
 */
export async function isSessionRevoked(opts: {
  jti: string
  userId: string
  iat: number
}): Promise<boolean> {
  pruneExpiredJtis()

  // Fast-path: jti revoked in this process.
  if (revokedJtis.has(opts.jti)) return true

  // Fast-path: user revoked after in this process.
  const localTs = userRevokedAfter.get(opts.userId)
  if (localTs && opts.iat * 1_000 < localTs) return true

  // DB fallback (handles cross-instance revocations).
  try {
    const hit = await RevokedSession.findOne({
      $or: [
        { jti: opts.jti },
        {
          userId: opts.userId,
          revokedAfter: { $gt: new Date(opts.iat * 1_000) },
        },
      ],
    })
      .select("_id")
      .lean()
    return Boolean(hit)
  } catch {
    return false
  }
}
