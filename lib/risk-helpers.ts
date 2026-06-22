
/**
 * 1. Late Repayments
 * Identify contracts where repayments are past their due date.
 * Returns a MongoDB query filter object.
 * Applicable Model: HirePurchaseContract
 */
export const buildLateRepaymentsQuery = (options?: { currentDate?: Date }) => {
  const now = options?.currentDate || new Date()
  return {
    status: "ACTIVE",
    nextDueDate: { $lt: now, $ne: null },
  }
}

/**
 * 2. Repeated Failed Transactions
 * Identify users/wallets with > X failed payment attempts within a timeframe.
 * Returns a MongoDB aggregation pipeline.
 * Applicable Model: Transaction or DriverPayment
 */
export const buildRepeatedFailedTransactionsPipeline = (options?: {
  threshold?: number
  daysFrame?: number
  currentDate?: Date
  userField?: string // e.g. "userId" or "driverUserId"
  dateField?: string // e.g. "timestamp" or "createdAt"
}) => {
  const threshold = options?.threshold ?? 3
  const daysFrame = options?.daysFrame ?? 7
  const now = options?.currentDate || new Date()
  const timeLimit = new Date(now.getTime() - daysFrame * 24 * 60 * 60 * 1000)
  const userField = options?.userField ?? "userId"
  const dateField = options?.dateField ?? "timestamp"

  return [
    {
      $match: {
        status: { $in: ["Failed", "FAILED"] },
        [dateField]: { $gte: timeLimit },
      },
    },
    {
      $group: {
        _id: `$${userField}`,
        failedCount: { $sum: 1 },
        latestFailure: { $max: `$${dateField}` },
      },
    },
    {
      $match: {
        failedCount: { $gt: threshold },
      },
    },
    {
      $sort: { failedCount: -1 as const },
    },
  ]
}

/**
 * 3. Inactive Contracts/Drivers
 * Identify active contracts with zero activity over a set period.
 * Returns a MongoDB query filter object.
 * Applicable Model: HirePurchaseContract
 */
export const buildInactiveContractsQuery = (options?: {
  daysInactive?: number
  currentDate?: Date
}) => {
  const daysInactive = options?.daysInactive ?? 14
  const now = options?.currentDate || new Date()
  const timeLimit = new Date(now.getTime() - daysInactive * 24 * 60 * 60 * 1000)

  return {
    status: "ACTIVE",
    updatedAt: { $lt: timeLimit },
  }
}

/**
 * 4. Underperforming Pools
 * Flag vehicle pools falling below expected revenue metrics.
 * Returns a MongoDB aggregation pipeline.
 * Applicable Model: InvestmentPool
 */
export const buildUnderperformingPoolsPipeline = (options?: {
  expectedRevenueField?: string
  actualRevenueField?: string
  tolerancePercentage?: number
}) => {
  const tolerance = options?.tolerancePercentage ?? 0.8
  const expectedField = options?.expectedRevenueField ?? "targetAmountNgn"
  const actualField = options?.actualRevenueField ?? "currentRaisedNgn"

  return [
    {
      $match: {
        status: { $in: ["OPEN", "FUNDED", "ACTIVE"] },
      },
    },
    {
      $addFields: {
        performanceRatio: {
          $cond: [
            { $gt: [`$${expectedField}`, 0] },
            { $divide: [`$${actualField}`, `$${expectedField}`] },
            1, // if expected is 0, default to ratio of 1 (not underperforming)
          ],
        },
      },
    },
    {
      $match: {
        performanceRatio: { $lt: tolerance },
      },
    },
    {
      $sort: { performanceRatio: 1 as const },
    },
  ]
}

/**
 * 5. High-Value Wallet Funding
 * Flag wallet top-ups exceeding a suspicious threshold.
 * Returns a MongoDB query filter object.
 * Applicable Model: Transaction
 */
export const buildHighValueWalletFundingQuery = (options?: {
  suspiciousThresholdNgn?: number
}) => {
  const threshold = options?.suspiciousThresholdNgn ?? 500000 // default 500k NGN

  return {
    type: { $in: ["wallet_funding", "deposit"] },
    status: { $in: ["Completed", "PENDING", "Pending"] },
    amount: { $gt: threshold },
  }
}
