import { NextResponse } from "next/server"

import { withSessionRefresh } from "@/lib/auth/current-user"
import { authorizeRequest } from "@/lib/authorization/route"
import dbConnect from "@/lib/dbConnect"
import { createCsvStream } from "@/lib/exports/csv-stream"
import DriverPayment from "@/models/DriverPayment"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import Investment from "@/models/Investment"
import InvestmentPool from "@/models/InvestmentPool"
import PoolInvestment from "@/models/PoolInvestment"
import Transaction from "@/models/Transaction"
import User from "@/models/User"
import Vehicle from "@/models/Vehicle"

type ExportType = "deposits" | "investments" | "repayments" | "kyc" | "fleet" | "users"
type RangeType = "7d" | "30d" | "90d" | "all" | "custom"

const CURSOR_BATCH_SIZE = 250

function parseRange(raw: string | null): RangeType {
  return raw === "7d" || raw === "30d" || raw === "90d" || raw === "all" || raw === "custom" ? raw : "30d"
}

function buildWindow(range: RangeType, fromRaw: string | null, toRaw: string | null) {
  if (range === "all") return { startDate: null as Date | null, endDate: null as Date | null }
  if (range === "custom") {
    const startDate = fromRaw ? new Date(fromRaw) : null
    const endDate = toRaw ? new Date(toRaw) : null
    if (startDate && endDate && !Number.isNaN(startDate.getTime()) && !Number.isNaN(endDate.getTime())) {
      endDate.setHours(23, 59, 59, 999)
      return { startDate, endDate }
    }
  }
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - (range === "7d" ? 7 : range === "90d" ? 90 : 30))
  return { startDate, endDate: null as Date | null }
}

function dateMatch(field: string, startDate: Date | null, endDate: Date | null) {
  const range: Record<string, Date> = {}
  if (startDate) range.$gte = startDate
  if (endDate) range.$lte = endDate
  return Object.keys(range).length ? { [field]: range } : {}
}

function userName(user: any) {
  return user?.fullName || user?.name || user?.email || "Unknown User"
}

function csvResponse(headers: string[], rows: AsyncIterable<unknown[]>, filename: string) {
  return new NextResponse(createCsvStream(headers, rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  })
}

export async function GET(request: Request) {
  try {
    const auth = await authorizeRequest(request, "admin:report", { type: "report" })
    if ("response" in auth) return auth.response
    const { user, shouldRefreshSession } = auth
    await dbConnect()

    const { searchParams } = new URL(request.url)
    const type = (searchParams.get("type") || "deposits") as ExportType
    if (!(["deposits", "investments", "repayments", "kyc", "fleet", "users"] as string[]).includes(type)) {
      return NextResponse.json({ message: "Invalid export type" }, { status: 400 })
    }
    const range = parseRange(searchParams.get("range"))
    const { startDate, endDate } = buildWindow(range, searchParams.get("from"), searchParams.get("to"))
    let response: NextResponse

    if (type === "deposits") {
      async function* rows(): AsyncGenerator<unknown[]> {
        const cursor = Transaction.find({ type: { $in: ["deposit", "wallet_funding"] }, status: { $in: ["Completed", "completed", "SUCCESS", "success", "Successful", "successful"] }, ...dateMatch("timestamp", startDate, endDate) })
          .select("userId amount method status gatewayReference timestamp").populate({ path: "userId", select: "name fullName email" }).sort({ timestamp: -1, _id: -1 }).lean().cursor({ batchSize: CURSOR_BATCH_SIZE })
        for await (const item of cursor as AsyncIterable<any>) yield [item.timestamp ? new Date(item.timestamp).toISOString() : "", userName(item.userId), item.userId?.email || "", Number(item.amount || 0), item.method || "unknown", item.status || "unknown", item.gatewayReference || ""]
      }
      response = csvResponse(["Date", "User", "Email", "Amount (NGN)", "Method", "Status", "Reference"], rows(), `deposits-${range}.csv`)
    } else if (type === "investments") {
      async function* rows(): AsyncGenerator<unknown[]> {
        const poolCursor = PoolInvestment.find({ status: "CONFIRMED", ...dateMatch("createdAt", startDate, endDate) }).select("userId poolId amountNgn ownershipBps txRef status createdAt").populate([{ path: "userId", select: "name fullName email" }, { path: "poolId", select: "assetType status" }]).sort({ createdAt: -1, _id: -1 }).lean().cursor({ batchSize: CURSOR_BATCH_SIZE })
        for await (const item of poolCursor as AsyncIterable<any>) yield [item.createdAt ? new Date(item.createdAt).toISOString() : "", userName(item.userId), item.userId?.email || "", "pool", item.poolId ? `${item.poolId.assetType} (${item.poolId.status})` : "Pool", Number(item.amountNgn || 0), Number(item.ownershipBps || 0) / 100, item.status || "unknown", item.txRef || ""]
        const legacyCursor = Investment.find({ status: { $in: ["Active", "Completed"] }, ...dateMatch("date", startDate, endDate) }).select("investorId vehicleId amount status date").populate([{ path: "investorId", select: "name fullName email" }, { path: "vehicleId", select: "name type" }]).sort({ date: -1, _id: -1 }).lean().cursor({ batchSize: CURSOR_BATCH_SIZE })
        for await (const item of legacyCursor as AsyncIterable<any>) yield [item.date ? new Date(item.date).toISOString() : "", userName(item.investorId), item.investorId?.email || "", "legacy", item.vehicleId?.name || item.vehicleId?.type || "Vehicle", Number(item.amount || 0), "", item.status || "unknown", ""]
      }
      response = csvResponse(["Date", "User", "Email", "Source", "Asset", "Amount (NGN)", "Ownership (%)", "Status", "Reference"], rows(), `investments-${range}.csv`)
    } else if (type === "repayments") {
      async function* rows(): AsyncGenerator<unknown[]> {
        const cursor = DriverPayment.find({ status: "CONFIRMED", ...dateMatch("createdAt", startDate, endDate) }).select("driverUserId contractId amountNgn appliedAmountNgn method paystackRef status createdAt").populate([{ path: "driverUserId", select: "name fullName email" }, { path: "contractId", select: "vehicleDisplayName" }]).sort({ createdAt: -1, _id: -1 }).lean().cursor({ batchSize: CURSOR_BATCH_SIZE })
        for await (const item of cursor as AsyncIterable<any>) yield [item.createdAt ? new Date(item.createdAt).toISOString() : "", userName(item.driverUserId), item.driverUserId?.email || "", item.contractId?.vehicleDisplayName || "Contract", Number(item.amountNgn || 0), Number(item.appliedAmountNgn || 0), item.method || "PAYSTACK", item.paystackRef || "", item.status || "unknown"]
      }
      response = csvResponse(["Date", "Driver", "Email", "Vehicle/Contract", "Amount (NGN)", "Applied Amount (NGN)", "Method", "Reference", "Status"], rows(), `repayments-${range}.csv`)
    } else if (type === "kyc") {
      const query: Record<string, unknown> = { kycStatus: { $ne: "none" }, ...dateMatch("createdAt", startDate, endDate) }
      const status = searchParams.get("status") || ""
      if (["pending", "approved", "rejected"].includes(status)) query.kycStatus = status
      async function* rows(): AsyncGenerator<unknown[]> { const cursor = User.find(query).select("name fullName email role kycStatus kycVerified createdAt").sort({ createdAt: -1, _id: -1 }).lean().cursor({ batchSize: CURSOR_BATCH_SIZE }); for await (const item of cursor as AsyncIterable<any>) yield [item.createdAt ? new Date(item.createdAt).toISOString() : "", userName(item), item.email || "", item.role || "", item.kycStatus || "none", item.kycVerified ? "Yes" : "No"] }
      response = csvResponse(["Date Joined", "Name", "Email", "Role", "KYC Status", "KYC Verified"], rows(), `kyc-report-${range}.csv`)
    } else if (type === "fleet") {
      const query: Record<string, unknown> = {}; const status = searchParams.get("vstatus") || ""; if (["Available", "Financed", "Reserved", "Maintenance", "Retired"].includes(status)) query.status = status
      async function* rows(): AsyncGenerator<unknown[]> { const cursor = Vehicle.find(query).select("name identifier type year price status fundingStatus totalFundedAmount addedDate").sort({ addedDate: -1, _id: -1 }).lean().cursor({ batchSize: CURSOR_BATCH_SIZE }); for await (const item of cursor as AsyncIterable<any>) yield [item.addedDate ? new Date(item.addedDate).toISOString() : "", item.name || "", item.identifier || "", item.type || "", item.year || "", Number(item.price || 0), item.status || "", item.fundingStatus || "", Number(item.totalFundedAmount || 0)] }
      response = csvResponse(["Date Added", "Name", "Identifier", "Type", "Year", "Price (NGN)", "Status", "Funding Status", "Total Funded (NGN)"], rows(), `fleet-report-${range}.csv`)
    } else {
      const query: Record<string, unknown> = { ...dateMatch("createdAt", startDate, endDate) }; const role = searchParams.get("role") || ""; if (["driver", "investor", "admin"].includes(role)) query.role = role
      async function* rows(): AsyncGenerator<unknown[]> { const cursor = User.find(query).select("name fullName email role kycVerified createdAt").sort({ createdAt: -1, _id: -1 }).lean().cursor({ batchSize: CURSOR_BATCH_SIZE }); for await (const item of cursor as AsyncIterable<any>) yield [item.createdAt ? new Date(item.createdAt).toISOString() : "", userName(item), item.email || "", item.role || "", item.kycVerified ? "Yes" : "No"] }
      response = csvResponse(["Date Joined", "Name", "Email", "Role", "KYC Verified"], rows(), `users-report-${range}.csv`)
    }
    return shouldRefreshSession ? await withSessionRefresh(response, user) : response
  } catch (error) {
    console.error("ADMIN_REPORT_EXPORT_ERROR", error)
    return NextResponse.json({ message: "Failed to export report." }, { status: 500 })
  }
}
