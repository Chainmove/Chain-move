import { NextResponse } from "next/server"
import mongoose from "mongoose"
import { z } from "zod"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import InvestmentPool from "@/models/InvestmentPool"
import PoolInvestment from "@/models/PoolInvestment"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import Transaction from "@/models/Transaction"
import Investment from "@/models/Investment"
import Vehicle from "@/models/Vehicle"

const querySchema = z.object({
  investorId: z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid investorId.").optional(),
})

export async function GET(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin", "investor"], {
      forbiddenMessage: "Investor or admin access required",
    })
    if ("response" in authContext) return authContext.response

    const query = parseSearchParams(request, querySchema)
    if ("response" in query) return query.response

    await dbConnect()

    const investorId =
      authContext.user.role === "admin" && query.data.investorId
        ? query.data.investorId
        : authContext.user._id.toString()

    const userObjectId = new mongoose.Types.ObjectId(investorId)

    // 1. Fetch User details for available balance and baseline info
    const user = await User.findById(userObjectId).lean()
    if (!user) {
      return NextResponse.json({ error: "Investor not found" }, { status: 404 })
    }

    const availableBalance = user.availableBalance || 0

    // 2. Fetch all CONFIRMED Pool Investments for this investor
    const poolInvestments = await PoolInvestment.find({
      userId: userObjectId,
      status: "CONFIRMED",
    }).lean()

    // 3. Fetch all direct legacy investments for this investor
    const legacyInvestments = await Investment.find({
      investorId: userObjectId,
      status: { $in: ["Active", "Completed"] },
    }).lean()

    // Retrieve unique pool IDs and vehicle IDs
    const poolIds = poolInvestments.map((pi) => pi.poolId)
    const directVehicleIds = legacyInvestments.map((li) => li.vehicleId)

    // Fetch referenced Investment Pools and Vehicles
    const pools = await InvestmentPool.find({ _id: { $in: poolIds } }).lean()
    const legacyVehicles = await Vehicle.find({ _id: { $in: directVehicleIds } }).lean()

    // Fetch all HirePurchaseContracts for these pools
    const contracts = await HirePurchaseContract.find({
      poolId: { $in: poolIds },
    }).lean()

    // Fetch return transactions to compute actual return per pool/investment
    const returnTransactions = await Transaction.find({
      userId: userObjectId,
      type: "return",
      status: "Completed",
    }).lean()

    // Helper map of returns by relatedId
    const returnsByRelatedId = new Map<string, number>()
    returnTransactions.forEach((tx) => {
      const relId = tx.relatedId?.toString()
      if (relId) {
        returnsByRelatedId.set(relId, (returnsByRelatedId.get(relId) || 0) + tx.amount)
      }
    })

    const poolMap = new Map(pools.map((p) => [p._id.toString(), p]))
    const vehicleMap = new Map(legacyVehicles.map((v) => [v._id.toString(), v]))

    let totalInvested = 0
    let totalReturnsEarned = 0
    let totalExpectedLifetime = 0
    let totalExpectedToDate = 0

    const now = new Date()

    // Group contracts by poolId
    const contractsByPool = new Map<string, typeof contracts>()
    contracts.forEach((c) => {
      const pid = c.poolId.toString()
      if (!contractsByPool.has(pid)) {
        contractsByPool.set(pid, [])
      }
      contractsByPool.get(pid)!.push(c)
    })

    // Build Active Pool Positions
    const activePositions = poolInvestments.map((pi) => {
      const poolIdStr = pi.poolId.toString()
      const pool = poolMap.get(poolIdStr)
      const poolContracts = contractsByPool.get(poolIdStr) || []
      const actualReturns = returnsByRelatedId.get(poolIdStr) || 0

      totalInvested += pi.amountNgn
      totalReturnsEarned += actualReturns

      let expectedReturnsLifetime = 0
      let expectedReturnsToDate = 0
      let poolTotalPayable = 0
      let poolTotalPaid = 0

      const formattedContracts = poolContracts.map((c) => {
        const principal = c.principalNgn || 0
        const totalPayable = c.totalPayableNgn || 0
        const totalPaid = c.totalPaidNgn || 0
        const markup = Math.max(0, totalPayable - principal)

        // Calculate weeks elapsed
        const startDate = new Date(c.startDate)
        const msElapsed = now.getTime() - startDate.getTime()
        const weeksElapsed = msElapsed / (1000 * 60 * 60 * 24 * 7)
        const durationWeeks = c.durationWeeks || 1
        const fractionElapsed = Math.min(1, Math.max(0, weeksElapsed / durationWeeks))

        const contractExpectedLifetime = markup * (pi.ownershipBps / 10000)
        const contractExpectedToDate = contractExpectedLifetime * fractionElapsed

        expectedReturnsLifetime += contractExpectedLifetime
        expectedReturnsToDate += contractExpectedToDate
        poolTotalPayable += totalPayable
        poolTotalPaid += totalPaid

        return {
          id: c._id.toString(),
          vehicleDisplayName: c.vehicleDisplayName,
          principal,
          totalPayable,
          totalPaid,
          status: c.status,
          startDate: c.startDate.toISOString(),
          progressPercent: totalPayable > 0 ? (totalPaid / totalPayable) * 100 : 0,
        }
      })

      // If no contract exists yet, use a default 24% annual ROI assumption
      if (poolContracts.length === 0) {
        const creationDate = new Date(pi.createdAt || (pool ? pool.createdAt : now))
        const msElapsed = now.getTime() - creationDate.getTime()
        const daysElapsed = msElapsed / (1000 * 60 * 60 * 24)

        // Assume standard 2-year tenure (104 weeks) for estimation
        expectedReturnsLifetime = pi.amountNgn * 0.24 * 2
        expectedReturnsToDate = pi.amountNgn * 0.24 * (daysElapsed / 365)
      }

      totalExpectedLifetime += expectedReturnsLifetime
      totalExpectedToDate += expectedReturnsToDate

      const repaymentProgressPercent =
        poolTotalPayable > 0 ? (poolTotalPaid / poolTotalPayable) * 100 : 0

      return {
        id: pi._id.toString(),
        poolId: poolIdStr,
        assetType: pool?.assetType || "KEKE",
        status: pool?.status || "OPEN",
        targetAmountNgn: pool?.targetAmountNgn || 0,
        currentRaisedNgn: pool?.currentRaisedNgn || 0,
        userInvestedNgn: pi.amountNgn,
        userOwnershipBps: pi.ownershipBps,
        expectedReturnsLifetime,
        expectedReturnsToDate,
        actualReturnsToDate: actualReturns,
        repaymentProgressPercent,
        contractsCount: poolContracts.length,
        contracts: formattedContracts,
        createdAt: pi.createdAt.toISOString(),
      }
    })

    // Build Legacy Direct Positions
    const legacyPositions = legacyInvestments.map((li) => {
      const vehicleIdStr = li.vehicleId.toString()
      const vehicle = vehicleMap.get(vehicleIdStr)
      const actualReturns = returnsByRelatedId.get(li._id.toString()) || returnsByRelatedId.get(vehicleIdStr) || 0

      totalInvested += li.amount
      totalReturnsEarned += actualReturns

      const startDate = new Date(li.date)
      const msElapsed = now.getTime() - startDate.getTime()
      const monthsElapsed = Math.floor(msElapsed / (1000 * 60 * 60 * 24 * 30.44))

      // Direct investment has explicit monthlyReturn. Assume a typical 24-month lifespan.
      const monthlyReturn = li.monthlyReturn || (li.amount * 0.24 / 12)
      const expectedReturnsLifetime = monthlyReturn * 24
      const expectedReturnsToDate = monthlyReturn * Math.min(24, Math.max(0, monthsElapsed))

      totalExpectedLifetime += expectedReturnsLifetime
      totalExpectedToDate += expectedReturnsToDate

      return {
        id: li._id.toString(),
        vehicleId: vehicleIdStr,
        vehicleName: vehicle?.name || "Direct Vehicle Investment",
        assetType: vehicle?.type || "SHUTTLE",
        status: li.status,
        amount: li.amount,
        monthlyReturn,
        expectedReturnsLifetime,
        expectedReturnsToDate,
        actualReturnsToDate: actualReturns,
        repaymentProgressPercent: li.status === "Completed" ? 100 : Math.min(100, (monthsElapsed / 24) * 100),
        startDate: startDate.toISOString(),
      }
    })

    // 4. Fetch recent transactions for this investor (limit 20)
    const transactions = await Transaction.find({
      userId: userObjectId,
    })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean()

    const formattedTransactions = transactions.map((t) => ({
      id: t._id.toString(),
      type: t.type,
      amount: t.amount,
      currency: t.currency || "NGN",
      method: t.method || "system",
      status: t.status || "Completed",
      description: t.description || "",
      timestamp: t.timestamp.toISOString(),
    }))

    // 5. Portfolio stats
    const totalPortfolioValue = availableBalance + totalInvested + totalReturnsEarned
    const averageRoi = totalInvested > 0 ? (totalReturnsEarned / totalInvested) * 100 : 0

    const isEmptyState =
      poolInvestments.length === 0 &&
      legacyInvestments.length === 0 &&
      availableBalance === 0 &&
      transactions.length === 0

    const response = NextResponse.json({
      success: true,
      totals: {
        totalInvested,
        availableBalance,
        totalReturns: totalReturnsEarned,
        totalExpectedToDate,
        totalExpectedLifetime,
        totalPortfolioValue,
        averageRoi,
      },
      activePositions,
      legacyPositions,
      transactions: formattedTransactions,
      emptyState: isEmptyState,
    })

    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("INVESTOR_DASHBOARD_API_ERROR", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
