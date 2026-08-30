import type { PoolSummary } from "@/lib/api/contracts"
import { money, serializeDateTime, serializeId } from "@/lib/api/serialization"

/**
 * Service-layer pool shape. Amounts are NGN major units, which the API
 * converts to the canonical `Money` representation on the way out.
 */
interface ServicePool {
  id?: unknown
  _id?: unknown
  assetType: string
  assetPriceNgn?: number
  targetAmountNgn?: number
  minContributionNgn?: number
  status: string
  currentRaisedNgn?: number
  remainingAmountNgn?: number
  investorCount?: number
  progressRatio?: number
  description?: string | null
  createdBy?: unknown
  createdAt?: unknown
  updatedAt?: unknown
  userOwnershipUnits?: number
  userOwnershipBps?: number
  userInvestedNgn?: number
}

export function serializePool(pool: ServicePool): PoolSummary {
  const targetAmountNgn = pool.targetAmountNgn ?? 0
  const currentRaisedNgn = pool.currentRaisedNgn ?? 0

  const serialized: PoolSummary = {
    id: (serializeId(pool.id ?? pool._id) ?? "") as string,
    assetType: pool.assetType,
    assetPrice: money(pool.assetPriceNgn ?? 0),
    targetAmount: money(targetAmountNgn),
    minContribution: money(pool.minContributionNgn ?? 0),
    status: pool.status as PoolSummary["status"],
    currentRaised: money(currentRaisedNgn),
    remainingAmount: money(pool.remainingAmountNgn ?? Math.max(targetAmountNgn - currentRaisedNgn, 0)),
    investorCount: pool.investorCount ?? 0,
    progressRatio: pool.progressRatio ?? (targetAmountNgn > 0 ? currentRaisedNgn / targetAmountNgn : 0),
    description: pool.description ?? null,
    createdBy: (serializeId(pool.createdBy) ?? "") as string,
    createdAt: serializeDateTime(pool.createdAt as Date) ?? new Date(0).toISOString(),
    updatedAt: serializeDateTime(pool.updatedAt as Date) ?? new Date(0).toISOString(),
  }

  // Per-user ownership is only present when the pool was loaded for a caller.
  if (typeof pool.userOwnershipUnits === "number") {
    serialized.userOwnershipUnits = pool.userOwnershipUnits
    serialized.userOwnershipBps = pool.userOwnershipBps ?? 0
    serialized.userInvested = money(pool.userInvestedNgn ?? 0)
  }

  return serialized
}
