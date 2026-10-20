/**
 * Pool Lifecycle Service
 *
 * Enforces the vehicle investment pool state machine.  All status changes
 * must go through `transitionPoolStatus` — never update the pool model
 * directly in other services.
 *
 * Transition matrix:
 *   draft        → review | cancelled
 *   review       → funding | cancelled
 *   funding      → fully_funded | closing | cancelled
 *   fully_funded → closing | cancelled
 *   closing      → active | cancelled
 *   active       → paused | completed | cancelled
 *   paused       → active | cancelled
 *   completed    → archived
 *   cancelled    → (terminal — no further transitions)
 *   archived     → (terminal — no further transitions)
 */

import mongoose from "mongoose"

import dbConnect from "@/lib/dbConnect"
import { logAuditEvent } from "@/lib/security/audit-log"
import InvestmentPool, { type PoolStatus } from "@/models/InvestmentPool"
import PoolTransitionHistory from "@/models/PoolTransitionHistory"

type NormalisedStatus = Exclude<PoolStatus, "OPEN" | "FUNDED" | "CLOSED">

/** Normalise legacy string aliases to canonical lifecycle statuses */
function normalise(status: PoolStatus): NormalisedStatus {
  if (status === "OPEN") return "funding"
  if (status === "FUNDED") return "fully_funded"
  if (status === "CLOSED") return "completed"
  return status as NormalisedStatus
}

const ALLOWED_TRANSITIONS: Record<NormalisedStatus, NormalisedStatus[]> = {
  draft: ["review", "cancelled"],
  review: ["funding", "cancelled"],
  funding: ["fully_funded", "closing", "cancelled"],
  fully_funded: ["closing", "cancelled"],
  closing: ["active", "cancelled"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: ["archived"],
  cancelled: [],
  archived: [],
}

/** Roles that may initiate a given transition */
const ACTOR_PERMISSIONS: Partial<Record<NormalisedStatus, string[]>> = {
  review: ["admin"],
  funding: ["admin"],
  closing: ["admin"],
  active: ["admin"],
  completed: ["admin"],
  archived: ["admin"],
  cancelled: ["admin"],
  paused: ["admin"],
  fully_funded: ["system", "admin"],
}

export interface TransitionOptions {
  actorId?: string
  actorRole?: string
  reason?: string
}

export interface TransitionResult {
  poolId: string
  fromStatus: NormalisedStatus
  toStatus: NormalisedStatus
  correlationId: string
}

/**
 * Atomically transition a pool's status.
 *
 * Throws if the transition is invalid, the actor lacks permission, or
 * a concurrent modification is detected (optimistic concurrency).
 */
export async function transitionPoolStatus(
  poolId: string,
  toStatus: NormalisedStatus,
  options: TransitionOptions = {},
): Promise<TransitionResult> {
  await dbConnect()

  if (!mongoose.Types.ObjectId.isValid(poolId)) {
    throw new Error(`Invalid pool ID: ${poolId}`)
  }

  const pool = await InvestmentPool.findById(poolId)
  if (!pool) throw new Error(`Pool not found: ${poolId}`)

  const currentStatus = normalise(pool.status)
  const allowed = ALLOWED_TRANSITIONS[currentStatus] ?? []

  if (!allowed.includes(toStatus)) {
    throw new Error(
      `Invalid transition: ${currentStatus} → ${toStatus}. Allowed: [${allowed.join(", ")}]`,
    )
  }

  // Permission check
  const requiredRoles = ACTOR_PERMISSIONS[toStatus]
  if (requiredRoles && options.actorRole && !requiredRoles.includes(options.actorRole)) {
    throw new Error(`Actor role '${options.actorRole}' is not permitted to initiate '${toStatus}'.`)
  }

  // Precondition checks
  await assertPreconditions(pool, toStatus)

  const session = await mongoose.startSession()
  let correlationId = ""

  try {
    await session.withTransaction(async () => {
      // Optimistic concurrency: findOneAndUpdate with current __v
      const updated = await InvestmentPool.findOneAndUpdate(
        { _id: pool._id, __v: pool.__v },
        {
          $set: {
            status: toStatus,
            ...(toStatus === "closing" || toStatus === "fully_funded"
              ? { fundingCapacityNgn: pool.currentRaisedNgn }
              : {}),
          },
          $inc: { __v: 1 },
        },
        { new: true, session },
      )

      if (!updated) {
        throw new Error("Concurrent modification detected — please retry.")
      }

      const historyEntry = await PoolTransitionHistory.create(
        [
          {
            poolId: pool._id,
            fromStatus: currentStatus,
            toStatus,
            actorId: options.actorId
              ? new mongoose.Types.ObjectId(options.actorId)
              : null,
            actorRole: options.actorRole ?? null,
            reason: options.reason ?? null,
          },
        ],
        { session },
      )

      correlationId = historyEntry[0].correlationId
    })
  } finally {
    await session.endSession()
  }

  await logAuditEvent({
    action: "pool.status_transition",
    targetType: "investment_pool",
    targetId: poolId,
    metadata: {
      fromStatus: currentStatus,
      toStatus,
      actorId: options.actorId,
      reason: options.reason,
      correlationId,
    },
  })

  return { poolId, fromStatus: currentStatus, toStatus, correlationId }
}

/** Domain preconditions that must hold before entering a given state */
async function assertPreconditions(
  pool: Awaited<ReturnType<typeof InvestmentPool.findById>>,
  toStatus: NormalisedStatus,
): Promise<void> {
  if (!pool) return

  if (toStatus === "closing" || toStatus === "fully_funded") {
    if (pool.currentRaisedNgn <= 0) {
      throw new Error("Cannot close funding: no investments have been made.")
    }
  }

  if (toStatus === "active") {
    if (!pool.fundingCapacityNgn || pool.fundingCapacityNgn <= 0) {
      throw new Error("Cannot activate pool: funding has not been closed/frozen.")
    }
  }
}

/** Returns the normalised status so callers don't need to import normalise */
export function resolvePoolStatus(status: PoolStatus): NormalisedStatus {
  return normalise(status)
}

/** Whether a pool is currently accepting new investments */
export function isPoolAcceptingInvestments(status: PoolStatus): boolean {
  const s = normalise(status)
  return s === "funding"
}

/**
 * Expire underfunded pools whose fundingDeadline has passed.
 * Intended to be called from a scheduled job.
 * Returns the number of pools cancelled.
 */
export async function expireUnderfundedPools(): Promise<number> {
  await dbConnect()

  const now = new Date()
  const expired = await InvestmentPool.find({
    status: { $in: ["funding", "OPEN"] },
    fundingDeadline: { $lt: now },
  })

  let count = 0
  for (const pool of expired) {
    try {
      await transitionPoolStatus(pool._id.toString(), "cancelled", {
        actorRole: "system",
        reason: "Funding deadline expired without reaching target.",
      })
      count++
    } catch {
      // Log and continue — one failure must not block others
    }
  }
  return count
}
