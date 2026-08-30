/**
 * Structured security event logger.
 *
 * Records authentication-relevant events without ever logging tokens, secrets,
 * passwords, or full session payloads. All events are written as structured
 * JSON lines to stdout so they can be ingested by log aggregators.
 *
 * Events are also stored to MongoDB for audit and incident-response queries,
 * but the DB write is fire-and-forget — a DB failure must never block an auth
 * response.
 */

import mongoose from "mongoose"

// ── Event types ───────────────────────────────────────────────────────────────

export type AuthEventType =
  | "login"
  | "signup"
  | "logout"
  | "session_revoked"
  | "token_invalid"
  | "token_expired"
  | "token_wrong_audience"
  | "token_wrong_issuer"
  | "token_unsupported_algorithm"
  | "jwks_rotation_detected"
  | "jwks_fetch_failed"
  | "role_changed"
  | "role_stale_rejected"
  | "stellar_linked"
  | "stellar_link_rejected"
  | "stellar_link_cross_account"
  | "high_risk_action_attempted"
  | "high_risk_action_denied_recent_auth"
  | "csrf_rejected"
  | "account_enumeration_blocked"
  | "rate_limit_exceeded"
  | "privy_subject_mismatch"

export interface AuthEvent {
  type: AuthEventType
  userId?: string
  privyUserId?: string
  ipAddress?: string
  userAgent?: string
  detail?: string
  metadata?: Record<string, unknown>
  timestamp: Date
}

// ── Mongoose schema (TTL: 90 days) ────────────────────────────────────────────

const AuthEventSchema = new mongoose.Schema<AuthEvent>({
  type: { type: String, required: true, index: true },
  userId: { type: String, index: true, sparse: true },
  privyUserId: { type: String, index: true, sparse: true },
  ipAddress: { type: String },
  userAgent: { type: String },
  detail: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
})

AuthEventSchema.index({ timestamp: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 90 })

const AuthEventModel =
  (mongoose.models.AuthEvent as mongoose.Model<AuthEvent>) ||
  mongoose.model<AuthEvent>("AuthEvent", AuthEventSchema)

// ── Public API ────────────────────────────────────────────────────────────────

export interface LogAuthEventOptions {
  type: AuthEventType
  userId?: string
  privyUserId?: string
  request?: Pick<Request, "headers">
  detail?: string
  metadata?: Record<string, unknown>
}

/**
 * Logs a security-relevant authentication event.
 * Never includes tokens, secrets, or passwords in the log record.
 * DB write is fire-and-forget.
 */
export function logAuthEvent(opts: LogAuthEventOptions): void {
  const event: AuthEvent = {
    type: opts.type,
    userId: opts.userId,
    privyUserId: opts.privyUserId,
    ipAddress: opts.request ? extractIp(opts.request) : undefined,
    userAgent: opts.request?.headers.get("user-agent") ?? undefined,
    detail: opts.detail,
    metadata: opts.metadata,
    timestamp: new Date(),
  }

  // Synchronous structured log to stdout.
  console.log(JSON.stringify({ authEvent: event }))

  // Async DB write — never awaited so it cannot block a response.
  AuthEventModel.create(event).catch(() => {})
}

function extractIp(request: Pick<Request, "headers">): string | undefined {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    undefined
  )
}

/** Returns recent auth events for a user (for incident-response tooling). */
export async function getRecentAuthEvents(userId: string, limit = 50): Promise<AuthEvent[]> {
  return AuthEventModel.find({ userId }).sort({ timestamp: -1 }).limit(limit).lean()
}
