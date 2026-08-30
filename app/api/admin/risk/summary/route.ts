import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import dbConnect from "@/lib/dbConnect"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import Transaction from "@/models/Transaction"
import InvestmentPool from "@/models/InvestmentPool"
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

    const [
      lateRepaymentsCount,
      failedTransactionsResult,
      inactiveContractsCount,
      underperformingPoolsResult,
      highValueFundingCount,
    ] = await Promise.all([
      HirePurchaseContract.countDocuments(buildLateRepaymentsQuery()),
      Transaction.aggregate(buildRepeatedFailedTransactionsPipeline()),
      HirePurchaseContract.countDocuments(buildInactiveContractsQuery()),
      InvestmentPool.aggregate(buildUnderperformingPoolsPipeline()),
      Transaction.countDocuments(buildHighValueWalletFundingQuery()),
    ])

    const summary = {
      lateRepayments: lateRepaymentsCount,
      repeatedFailedTransactions: failedTransactionsResult.length,
      inactiveContracts: inactiveContractsCount,
      underperformingPools: underperformingPoolsResult.length,
      highValueWalletFundings: highValueFundingCount,
    }

    const response = NextResponse.json({ success: true, summary })
    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    console.error("ADMIN_RISK_SUMMARY_ERROR", error)
    return NextResponse.json({ message: "Failed to load risk summary." }, { status: 500 })
  }
}
