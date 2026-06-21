import mongoose from "mongoose"

import dbConnect from "@/lib/dbConnect"
import Investment from "@/models/Investment"
import InvestmentPool from "@/models/InvestmentPool"
import PoolInvestment from "@/models/PoolInvestment"
import Transaction from "@/models/Transaction"
import User from "@/models/User"

export type AnalyticsRange = "7d" | "30d" | "90d" | "all"

export interface AnalyticsWindow {
  range: AnalyticsRange
  startDate: Date | null
}

interface ScopeOptions {
  startDate?: Date | null
  userId?: string
}

interface PoolFundingSummary {
  openPoolsCount: number
  fundedPoolsCount: number
  closedPoolsCount: number
  activePoolsCount: number
  totalRaisedAcrossPoolsNgn: number
  totalTargetAcrossPoolsNgn: number
}

const COMPLETED_TRANSACTION_STATUSES = ["Completed", "completed", "SUCCESS", "success", "Successful", "successful"]
const DEPOSIT_TRANSACTION_TYPES = ["deposit", "wallet_funding"]
const VERIFIED_KYC_STATUSES = ["approved", "approved_stage2", "verified", "complete", "completed"]

export async function ensureAnalyticsDb() {
  await dbConnect()
}

export function parseAnalyticsRange(rawRange?: string | null): AnalyticsRange {
  if (rawRange === "7d" || rawRange === "30d" || rawRange === "90d" || rawRange === "all") {
    return rawRange
  }

  return "30d"
}

export function buildAnalyticsWindow(range: AnalyticsRange): AnalyticsWindow {
  if (range === "all") {
    return { range, startDate: null }
  }

  const now = new Date()
  const startDate = new Date(now)
  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30
  startDate.setDate(startDate.getDate() - days)

  return { range, startDate }
}

function asObjectId(userId?: string) {
  if (!userId || !mongoose.Types.ObjectId.isValid(userId)) return null
  return new mongoose.Types.ObjectId(userId)
}

function withDateScope(match: Record<string, unknown>, field: string, startDate?: Date | null) {
  if (startDate) {
    match[field] = { $gte: startDate }
  }
}

function withUserScope(match: Record<string, unknown>, userId?: string) {
  const scopedUserId = asObjectId(userId)
  if (scopedUserId) {
    match.userId = scopedUserId
  }
}

async function aggregateTotal({
  model,
  match,
  sumField,
}: {
  model: { aggregate: (pipeline: any[]) => Promise<any[]> }
  match: Record<string, unknown>
  sumField: string
}) {
  const rows = await model.aggregate([{ $match: match }, { $group: { _id: null, total: { $sum: sumField } } }])
  return Number(rows[0]?.total || 0)
}

export async function sumDepositsNgn({ startDate, userId }: ScopeOptions = {}) {
  const match: Record<string, unknown> = {
    type: { $in: DEPOSIT_TRANSACTION_TYPES },
    status: { $in: COMPLETED_TRANSACTION_STATUSES },
  }

  withDateScope(match, "timestamp", startDate)
  withUserScope(match, userId)

  return aggregateTotal({
    model: Transaction,
    match,
    sumField: "$amount",
  })
}

export async function sumReturnsPaidNgn({ startDate, userId }: ScopeOptions = {}) {
  const match: Record<string, unknown> = {
    type: "return",
    status: { $in: COMPLETED_TRANSACTION_STATUSES },
  }

  withDateScope(match, "timestamp", startDate)
  withUserScope(match, userId)

  return aggregateTotal({
    model: Transaction,
    match,
    sumField: "$amount",
  })
}

export async function sumPoolInvestmentsNgn({ startDate, userId }: ScopeOptions = {}) {
  const match: Record<string, unknown> = {
    status: "CONFIRMED",
  }

  withDateScope(match, "createdAt", startDate)
  withUserScope(match, userId)

  return aggregateTotal({
    model: PoolInvestment,
    match,
    sumField: "$amountNgn",
  })
}

export async function sumLegacyInvestmentsNgn({ startDate, userId }: ScopeOptions = {}) {
  const match: Record<string, unknown> = {
    status: { $in: ["Active", "Completed"] },
  }

  withDateScope(match, "date", startDate)
  const scopedUserId = asObjectId(userId)
  if (scopedUserId) {
    match.investorId = scopedUserId
  }

  return aggregateTotal({
    model: Investment,
    match,
    sumField: "$amount",
  })
}

export async function sumInvestmentsNgn(scope: ScopeOptions = {}) {
  const [poolInvestmentsNgn, legacyInvestmentsNgn] = await Promise.all([
    sumPoolInvestmentsNgn(scope),
    sumLegacyInvestmentsNgn(scope),
  ])

  return poolInvestmentsNgn + legacyInvestmentsNgn
}

export async function countUsers({ startDate }: ScopeOptions = {}) {
  const match: Record<string, unknown> = {}
  withDateScope(match, "createdAt", startDate)
  return User.countDocuments(match)
}

export async function countPrivyMappedUsers({ startDate }: ScopeOptions = {}) {
  const match: Record<string, unknown> = {
    privyUserId: { $exists: true, $nin: [null, ""] },
  }
  withDateScope(match, "createdAt", startDate)
  return User.countDocuments(match)
}

export async function countVerifiedUsers({ startDate }: ScopeOptions = {}) {
  const match: Record<string, unknown> = {
    $or: [
      { isKycVerified: true },
      { kycVerified: true },
      { kycStatus: { $in: VERIFIED_KYC_STATUSES } },
      { physicalMeetingStatus: { $in: ["approved", "verified", "completed"] } },
    ],
  }

  withDateScope(match, "createdAt", startDate)
  return User.countDocuments(match)
}

export async function getPoolFundingSummary({ startDate }: ScopeOptions = {}): Promise<PoolFundingSummary> {
  const match: Record<string, unknown> = {}
  withDateScope(match, "createdAt", startDate)

  const grouped = await InvestmentPool.aggregate([
    { $match: match },
    {
      $group: {
        _id: "$status",
        count: { $sum: 1 },
        raised: { $sum: "$currentRaisedNgn" },
        target: { $sum: "$targetAmountNgn" },
      },
    },
  ])

  let openPoolsCount = 0
  let fundedPoolsCount = 0
  let closedPoolsCount = 0
  let totalRaisedAcrossPoolsNgn = 0
  let totalTargetAcrossPoolsNgn = 0

  for (const row of grouped) {
    const status = String(row._id || "").toUpperCase()
    const count = Number(row.count || 0)
    const raised = Number(row.raised || 0)
    const target = Number(row.target || 0)

    totalRaisedAcrossPoolsNgn += raised
    totalTargetAcrossPoolsNgn += target

    if (status === "OPEN") openPoolsCount = count
    if (status === "FUNDED") fundedPoolsCount = count
    if (status === "CLOSED") closedPoolsCount = count
  }

  return {
    openPoolsCount,
    fundedPoolsCount,
    closedPoolsCount,
    activePoolsCount: openPoolsCount + fundedPoolsCount,
    totalRaisedAcrossPoolsNgn,
    totalTargetAcrossPoolsNgn,
  }
}

export async function getDepositMethodBreakdown({ startDate, userId }: ScopeOptions = {}) {
  const match: Record<string, unknown> = {
    type: { $in: DEPOSIT_TRANSACTION_TYPES },
    status: { $in: COMPLETED_TRANSACTION_STATUSES },
  }

  withDateScope(match, "timestamp", startDate)
  withUserScope(match, userId)

  const rows = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $ifNull: ["$method", "unknown"] },
        totalAmountNgn: { $sum: "$amount" },
        count: { $sum: 1 },
      },
    },
    { $sort: { totalAmountNgn: -1 } },
  ])

  return rows.map((row) => ({
    method: String(row._id || "unknown"),
    totalAmountNgn: Number(row.totalAmountNgn || 0),
    count: Number(row.count || 0),
  }))
}

