import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import dbConnect from "@/lib/dbConnect"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import Transaction from "@/models/Transaction"
import InvestmentPool from "@/models/InvestmentPool"
import User from "@/models/User" // In case population needs the model registered
import {
  buildLateRepaymentsQuery,
  buildRepeatedFailedTransactionsPipeline,
  buildInactiveContractsQuery,
  buildUnderperformingPoolsPipeline,
  buildHighValueWalletFundingQuery,
} from "@/lib/risk-helpers"

export async function GET(request: Request) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    if (user.role !== "admin") {
      return NextResponse.json({ message: "Forbidden" }, { status: 403 })
    }

    await dbConnect()

    const { searchParams } = new URL(request.url)
    const type = searchParams.get("type") // e.g., late_repayments
    const page = parseInt(searchParams.get("page") || "1")
    const limit = parseInt(searchParams.get("limit") || "10")
    const skip = (page - 1) * limit

    let records: any[] = []
    let total = 0

    // Construct options from search params for flexibility
    const options: any = {}
    if (searchParams.get("daysInactive")) options.daysInactive = parseInt(searchParams.get("daysInactive")!)
    if (searchParams.get("threshold")) options.threshold = parseInt(searchParams.get("threshold")!)
    if (searchParams.get("daysFrame")) options.daysFrame = parseInt(searchParams.get("daysFrame")!)
    if (searchParams.get("suspiciousThresholdNgn")) options.suspiciousThresholdNgn = parseInt(searchParams.get("suspiciousThresholdNgn")!)

    switch (type) {
      case "late_repayments": {
        const query = buildLateRepaymentsQuery(options)
        total = await HirePurchaseContract.countDocuments(query)
        records = await HirePurchaseContract.find(query)
          .skip(skip)
          .limit(limit)
          .populate("driverUserId", "name email privyUserId")
          .lean()
        break
      }
      case "repeated_failed_transactions": {
        const pipeline = buildRepeatedFailedTransactionsPipeline(options)
        
        // Count via aggregation
        const countPipeline = [...pipeline, { $count: "total" }]
        const countResult = await Transaction.aggregate(countPipeline)
        total = countResult[0]?.total || 0

        // Fetch data
        const dataPipeline = [...pipeline, { $skip: skip }, { $limit: limit }]
        records = await Transaction.aggregate(dataPipeline)
        
        // Populate User info (where _id is the grouped userId)
        await User.populate(records, { path: "_id", select: "name email privyUserId" })
        break
      }
      case "inactive_contracts": {
        const query = buildInactiveContractsQuery(options)
        total = await HirePurchaseContract.countDocuments(query)
        records = await HirePurchaseContract.find(query)
          .skip(skip)
          .limit(limit)
          .populate("driverUserId", "name email privyUserId")
          .lean()
        break
      }
      case "underperforming_pools": {
        const pipeline = buildUnderperformingPoolsPipeline(options)
        
        // Count
        const countPipeline = [...pipeline, { $count: "total" }]
        const countResult = await InvestmentPool.aggregate(countPipeline)
        total = countResult[0]?.total || 0

        // Data
        const dataPipeline = [...pipeline, { $skip: skip }, { $limit: limit }]
        records = await InvestmentPool.aggregate(dataPipeline)
        break
      }
      case "high_value_wallet_funding": {
        const query = buildHighValueWalletFundingQuery(options)
        total = await Transaction.countDocuments(query)
        records = await Transaction.find(query)
          .skip(skip)
          .limit(limit)
          .populate("userId", "name email privyUserId")
          .lean()
        break
      }
      default:
        return NextResponse.json({ message: "Invalid or missing risk type." }, { status: 400 })
    }

    const response = NextResponse.json({
      success: true,
      data: {
        records,
        pagination: {
          total,
          page,
          limit,
          totalPages: Math.ceil(total / limit),
        },
      },
    })

    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    console.error("ADMIN_RISK_DETAILS_ERROR", error)
    return NextResponse.json({ message: "Failed to load risk details." }, { status: 500 })
  }
}
