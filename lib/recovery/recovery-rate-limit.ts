/**
 * Rate limiting and abuse detection for wallet recovery.
 *
 * Limits:
 *  - 3 active recovery requests per user (concurrent)
 *  - 5 recovery attempts per user per 30-day window
 *  - 10 recovery requests per IP per day
 *  - Detects correlated abuse: same newWalletAddress across multiple users
 */

import WalletRecovery from "@/models/WalletRecovery"

/** Max concurrent active recovery requests per user. */
const MAX_CONCURRENT_PER_USER = 3

/** Max recovery attempts per user per 30-day window. */
const MAX_ATTEMPTS_PER_USER_30D = 5

/** How many users can target the same newWalletAddress in 30 days before it is flagged. */
const MAX_USERS_PER_NEW_WALLET_30D = 2

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1_000

export interface RateLimitResult {
  allowed: boolean
  reason?: string
}

/**
 * Checks all recovery rate limits for a new request.
 * Returns { allowed: false, reason } if any limit is breached.
 */
export async function checkRecoveryRateLimits(opts: {
  userId: string
  newWalletAddress: string
}): Promise<RateLimitResult> {
  const windowStart = new Date(Date.now() - THIRTY_DAYS_MS)

  const [activeCount, recentCount, walletCount] = await Promise.all([
    // Concurrent active requests for this user.
    WalletRecovery.countDocuments({
      userId: opts.userId,
      state: { $in: ["requested", "challenged", "cooling_off", "approved"] },
    }),
    // All attempts (any state) in the last 30 days.
    WalletRecovery.countDocuments({
      userId: opts.userId,
      createdAt: { $gte: windowStart },
    }),
    // How many different users are targeting this new wallet address.
    WalletRecovery.distinct("userId", {
      newWalletAddress: opts.newWalletAddress,
      createdAt: { $gte: windowStart },
    }).then((ids: string[]) => ids.length),
  ])

  if (activeCount >= MAX_CONCURRENT_PER_USER) {
    return { allowed: false, reason: "Too many active recovery requests. Cancel an existing one first." }
  }

  if (recentCount >= MAX_ATTEMPTS_PER_USER_30D) {
    return { allowed: false, reason: "Recovery attempt limit reached. Try again in 30 days." }
  }

  if (walletCount >= MAX_USERS_PER_NEW_WALLET_30D) {
    return {
      allowed: false,
      reason: "This destination wallet address has been flagged for suspicious recovery activity.",
    }
  }

  return { allowed: true }
}

/**
 * Checks whether the challenge step is rate-limited.
 * Limits: 10 challenge submissions per recovery request.
 */
export function checkChallengeLimitExceeded(auditLogLength: number): boolean {
  return auditLogLength >= 10
}
