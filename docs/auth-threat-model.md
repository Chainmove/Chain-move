# Authentication Threat Model

## Trust Boundaries

```
[Client Browser / Extension]
        │  Privy SDK (OIDC flow, ES256 JWT)
        ▼
[Next.js Edge / API Routes]  ←── Server-side only (lib/auth/*)
        │  Mongoose / MongoDB session & revocation store
        ▼
[MongoDB Atlas]
```

**Untrusted:** Everything from the client — tokens, cookies, headers, body fields.  
**Trusted:** Process environment variables (`JWT_SECRET`, `PRIVY_APP_ID`, `PRIVY_APP_SECRET`, `CSRF_SECRET`), MongoDB (integrity guaranteed by revocation + session signing).

## Privy Token Verification (`lib/auth/privy.ts` + `lib/auth/token-verifier.ts`)

| Claim | Enforcement |
|-------|-------------|
| `alg` | Explicitly restricted to `ES256`. Prevents `alg:none` and RS/HS256 confusion attacks. |
| `iss` | Must be one of the three canonical Privy issuer strings. |
| `aud` | Must equal `PRIVY_APP_ID`. |
| `exp` | Enforced by `jose` (+ 60-second clock skew tolerance). |
| `nbf` | Enforced by `jose`. |
| `iat` | Validated to be ≤ now + clock_skew. |
| `sub` | Validated to be present and non-empty. |

### JWKS Caching and Key Rotation

- JWKS is cached for 5 minutes (soft TTL). On expiry, a background refresh is triggered and the stale key set is served in the interim.
- On fetch failure, the stale cache is served for up to 10 minutes before hard-failing.
- Multiple concurrent requests coalesce into a single fetch (inflight deduplication).
- `jose`'s `createRemoteJWKSet` automatically validates key thumbprints; unknown key IDs cause `JWSSignatureVerificationFailed`.

## Session Lifecycle

```
┌──────────────────────────────────────────────────────────────┐
│                        SESSION STATE                         │
│                                                              │
│  Created ──► Active ──► [Role/email change] ──► Revoked      │
│                │                                             │
│                └──────────────────► Expired (7-day TTL)      │
│                                                              │
│  Logout ──────────────────────────► Revoked (jti-level)      │
└──────────────────────────────────────────────────────────────┘
```

- Sessions are signed HS256 JWTs with a `jti` (UUID) claim for per-token revocation.
- Cookies are `HttpOnly`, `Secure` (non-dev), `SameSite=Strict`, 7-day `maxAge`.
- `SameSite=Strict` prevents the session cookie from being sent on cross-site navigations. State-mutating routes additionally require an `x-csrf-token` header (`lib/auth/csrf.ts`) as defence-in-depth.

### Session Revocation (`lib/auth/session-revocation.ts`)

| Trigger | Scope | Mechanism |
|---------|-------|-----------|
| Logout | Single jti | `revokeSession(jti, ...)` |
| Role change | All sessions before timestamp | `revokeUserSessions(userId, ...)` |
| Suspected compromise | All sessions before timestamp | `revokeUserSessions(userId, ...)` |

Revocation is checked before any DB user lookup in `getAuthenticatedUser`. The in-process revocation map provides sub-millisecond rejection; the MongoDB `RevokedSession` collection propagates revocations across multiple server instances with a 90-day TTL via a MongoDB TTL index.

### Role Staleness

If the role stored in the session JWT differs from the role in the `User` document, the request is rejected and the caller must re-authenticate. This prevents a role-change from leaving an active elevated (or reduced) session in use.

## High-Risk Actions

The following actions require **recent authentication** (Privy token issued within the last N seconds):

| Action | Max Age | Library constant |
|--------|---------|-----------------|
| Stellar wallet link/replace | 2 min | `RECENT_AUTH_CRITICAL_MAX_AGE_SECONDS` |
| Role change (admin) | 5 min | `RECENT_AUTH_DEFAULT_MAX_AGE_SECONDS` |

In addition, the Privy token `sub` must match `user.privyUserId` to prevent token substitution attacks (using a valid token for a different Privy account).

## CSRF Protection (`lib/auth/csrf.ts`)

- CSRF tokens use `HMAC-SHA256(CSRF_SECRET, sessionId:expiresAt)` with a 1-hour expiry.
- State-mutating cookie-authenticated routes should validate `x-csrf-token` header.
- `SameSite=Strict` cookies provide the primary protection; CSRF tokens are defence-in-depth.
- CSRF validation is timing-safe (`crypto.timingSafeEqual`).

## Cross-Account Linking Prevention

- Stellar public key uniqueness is enforced by the DB index.
- The `POST /api/auth/stellar/link` route verifies that the linked key is not already owned by a different user, returning 409 before the save.
- The route additionally requires a fresh Privy token (`iat` ≤ 2 minutes) whose `sub` matches the authenticated user's `privyUserId`. A client cannot substitute another user's Privy token.

## Account Enumeration

- All 401 responses use the same generic message body regardless of whether the account exists.
- Error branches in `getAuthenticatedUser` return `{ user: null }` uniformly.
- The `/api/auth/me` route returns 401 (not 404) when a session is invalid.

## Security Event Logging (`lib/auth/auth-event-log.ts`)

All security-relevant events are logged as structured JSON to stdout (ingested by the platform's log aggregator) and persisted to MongoDB `AuthEvent` collection (90-day TTL). Events **never** include tokens, passwords, or secrets.

Logged events: `login`, `signup`, `logout`, `session_revoked`, `token_invalid`, `token_expired`, `token_wrong_audience`, `token_wrong_issuer`, `token_unsupported_algorithm`, `jwks_rotation_detected`, `jwks_fetch_failed`, `role_changed`, `role_stale_rejected`, `stellar_linked`, `stellar_link_rejected`, `stellar_link_cross_account`, `high_risk_action_attempted`, `high_risk_action_denied_recent_auth`, `csrf_rejected`, `account_enumeration_blocked`, `rate_limit_exceeded`, `privy_subject_mismatch`.

## Incident Response — Compromised Account

1. Call `revokeUserSessions(userId, { reason: "compromise" })` — invalidates all sessions immediately in this process; MongoDB propagates to other instances within seconds.
2. Rotate the user's Privy sessions through the Privy admin API (`PRIVY_APP_SECRET`).
3. Optionally set `user.role = null` / lock the account document.
4. Query `AuthEvent.find({ userId })` for the timeline of actions taken under the compromised session.
5. If the JWKS key is suspected compromised, rotate the Privy app's signing key in the Privy dashboard — the JWKS cache expires within 5–10 minutes, after which all new tokens use the rotated key.
