import mongoose from "mongoose"
import { NextResponse } from "next/server"

import dbConnect from "@/lib/dbConnect"
import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import DriverPayment from "@/models/DriverPayment"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import Investment from "@/models/Investment"
import PoolInvestment from "@/models/PoolInvestment"
import Transaction from "@/models/Transaction"
import User from "@/models/User"
import Vehicle from "@/models/Vehicle"
import InvestmentPool from "@/models/InvestmentPool"

type ExportType = "deposits" | "investments" | "repayments" | "kyc" | "fleet" | "users"
type RangeType = "7d" | "30d" | "90d" | "all" | "custom"

function csvEscape(value: unknown): string {
  const raw = value == null ? "" : String(value)
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, "\"\"")}"`
  }
  return raw
}

function toCsv(headers: string[], rows: Array<Array<unknown>>) {
  const lines = [headers.map(csvEscape).join(",")]
  for (const row of rows) {
    lines.push(row.map(csvEscape).join(","))
  }
  return lines.join("\n")
}

function parseRange(raw: string | null): RangeType {
  if (raw === "7d" || raw === "30d" || raw === "90d" || raw === "all" || raw === "custom") return raw
  return "30d"
}

function buildWindow(range: RangeType, fromRaw: string | null, toRaw: string | null) {
  if (range === "all") return { startDate: null as Date | null, endDate: null as Date | null }

  if (range === "custom") {
    const fromDate = fromRaw ? new Date(fromRaw) : null
    const toDate = toRaw ? new Date(toRaw) : null
    if (fromDate && toDate && !Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime())) {
      const endDate = new Date(toDate)
      endDate.setHours(23, 59, 59, 999)
      return { startDate: fromDate, endDate }
    }
  }

  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  return { startDate, endDate: null as Date | null }
}

function dateMatch(field: string, startDate: Date | null, endDate: Date | null) {
  if (!startDate && !endDate) return {}
  const clause: Record<string, Date> = {}
  if (startDate) clause.$gte = startDate
  if (endDate) clause.$lte = endDate
  return { [field]: clause }
}

function getUserName(user: any) {
  return user?.fullName || user?.name || user?.email || "Unknown User"
}

function normalizeObjectId(value: unknown) {
  if (value instanceof mongoose.Types.ObjectId) return value
  if (typeof value === "string" && mongoose.Types.ObjectId.isValid(value)) return new mongoose.Types.ObjectId(value)
  return null
}

function collectObjectIds(values: unknown[]) {
  const map = new Map<string, mongoose.Types.ObjectId>()
  for (const value of values) {
    const normalized = normalizeObjectId(value)
    if (!normalized) continue
    map.set(normalized.toString(), normalized)
  }
  return Array.from(map.values())
}

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
    const type = (searchParams.get("type") || "deposits") as ExportType
    if (!["deposits", "investments", "repayments", "kyc", "fleet", "users"].includes(type)) {
      return NextResponse.json({ message: "Invalid export type" }, { status: 400 })
    }

    const range = parseRange(searchParams.get("range"))
    const { startDate, endDate } = buildWindow(range, searchParams.get("from"), searchParams.get("to"))

    // ── deposits ────────────────────────────────────────────────────────────
    if (type === "deposits") {
      const deposits = await Transaction.find({
        type: { $in: ["deposit", "wallet_funding"] },
        status: { $in: ["Completed", "completed", "SUCCESS", "success", "Successful", "successful"] },
        ...dateMatch("timestamp", startDate, endDate),
      })
        .select("userId amount method status gatewayReference timestamp")
        .sort({ timestamp: -1 })
        .lean()

      const userIds = collectObjectIds(deposits.map((item: any) => item.userId))
      const users = userIds.length
        ? await User.find({ _id: { $in: userIds } }).select("name fullName email").lean()
        : []
      const userById = new Map(users.map((entry: any) => [entry._id.toString(), entry]))

      const csv = toCsv(
        ["Date", "User", "Email", "Amount (NGN)", "Method", "Status", "Reference"],
        deposits.map((item: any) => {
          const userEntry = userById.get(item.userId?.toString?.() || "")
          return [
            item.timestamp ? new Date(item.timestamp).toISOString() : "",
            getUserName(userEntry),
            userEntry?.email || "",
            Number(item.amount || 0),
            item.method || "unknown",
            item.status || "unknown",
            item.gatewayReference || "",
          ]
        }),
      )

      const response = new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="deposits-${range}.csv"`,
        },
      })
      return shouldRefreshSession ? withSessionRefresh(response, user) : response
    }

    // ── investments ──────────────────────────────────────────────────────────
    if (type === "investments") {
      const [poolInvestments, legacyInvestments] = await Promise.all([
        PoolInvestment.find({
          status: "CONFIRMED",
          ...dateMatch("createdAt", startDate, endDate),
        })
          .select("userId poolId amountNgn ownershipBps txRef status createdAt")
          .sort({ createdAt: -1 })
          .lean(),
        Investment.find({
          status: { $in: ["Active", "Completed"] },
          ...dateMatch("date", startDate, endDate),
        })
          .select("investorId vehicleId amount status date")
          .sort({ date: -1 })
          .lean(),
      ])

      const userIds = collectObjectIds([
        ...poolInvestments.map((item: any) => item.userId),
        ...legacyInvestments.map((item: any) => item.investorId),
      ])
      const poolIds = collectObjectIds(poolInvestments.map((item: any) => item.poolId))
      const vehicleIds = collectObjectIds(legacyInvestments.map((item: any) => item.vehicleId))

      const [users, pools, vehicles] = await Promise.all([
        userIds.length ? User.find({ _id: { $in: userIds } }).select("name fullName email").lean() : Promise.resolve([]),
        poolIds.length ? InvestmentPool.find({ _id: { $in: poolIds } }).select("assetType status").lean() : Promise.resolve([]),
        vehicleIds.length ? Vehicle.find({ _id: { $in: vehicleIds } }).select("name type").lean() : Promise.resolve([]),
      ])

      const userById = new Map(users.map((entry: any) => [entry._id.toString(), entry]))
      const poolById = new Map(pools.map((entry: any) => [entry._id.toString(), entry]))
      const vehicleById = new Map(vehicles.map((entry: any) => [entry._id.toString(), entry]))

      const poolRows = poolInvestments.map((item: any) => {
        const userEntry = userById.get(item.userId?.toString?.() || "")
        const pool = poolById.get(item.poolId?.toString?.() || "")
        return [
          item.createdAt ? new Date(item.createdAt).toISOString() : "",
          getUserName(userEntry),
          userEntry?.email || "",
          "pool",
          pool ? `${pool.assetType} (${pool.status})` : "Pool",
          Number(item.amountNgn || 0),
          Number(item.ownershipBps || 0) / 100,
          item.status || "unknown",
          item.txRef || "",
        ]
      })

      const legacyRows = legacyInvestments.map((item: any) => {
        const userEntry = userById.get(item.investorId?.toString?.() || "")
        const vehicle = vehicleById.get(item.vehicleId?.toString?.() || "")
        return [
          item.date ? new Date(item.date).toISOString() : "",
          getUserName(userEntry),
          userEntry?.email || "",
          "legacy",
          vehicle?.name || vehicle?.type || "Vehicle",
          Number(item.amount || 0),
          "",
          item.status || "unknown",
          "",
        ]
      })

      const csv = toCsv(
        ["Date", "User", "Email", "Source", "Asset", "Amount (NGN)", "Ownership (%)", "Status", "Reference"],
        [...poolRows, ...legacyRows],
      )

      const response = new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="investments-${range}.csv"`,
        },
      })
      return shouldRefreshSession ? withSessionRefresh(response, user) : response
    }

    // ── repayments ───────────────────────────────────────────────────────────
    if (type === "repayments") {
      const repayments = await DriverPayment.find({
        status: "CONFIRMED",
        ...dateMatch("createdAt", startDate, endDate),
      })
        .select("driverUserId contractId amountNgn appliedAmountNgn method paystackRef status createdAt")
        .sort({ createdAt: -1 })
        .lean()

      const userIds = collectObjectIds(repayments.map((item: any) => item.driverUserId))
      const contractIds = collectObjectIds(repayments.map((item: any) => item.contractId))

      const [users, contracts] = await Promise.all([
        userIds.length ? User.find({ _id: { $in: userIds } }).select("name fullName email").lean() : Promise.resolve([]),
        contractIds.length
          ? HirePurchaseContract.find({ _id: { $in: contractIds } }).select("vehicleDisplayName").lean()
          : Promise.resolve([]),
      ])

      const userById = new Map(users.map((entry: any) => [entry._id.toString(), entry]))
      const contractById = new Map(contracts.map((entry: any) => [entry._id.toString(), entry]))

      const csv = toCsv(
        ["Date", "Driver", "Email", "Vehicle/Contract", "Amount (NGN)", "Applied Amount (NGN)", "Method", "Reference", "Status"],
        repayments.map((item: any) => {
          const userEntry = userById.get(item.driverUserId?.toString?.() || "")
          const contract = contractById.get(item.contractId?.toString?.() || "")
          return [
            item.createdAt ? new Date(item.createdAt).toISOString() : "",
            getUserName(userEntry),
            userEntry?.email || "",
            contract?.vehicleDisplayName || "Contract",
            Number(item.amountNgn || 0),
            Number(item.appliedAmountNgn || 0),
            item.method || "PAYSTACK",
            item.paystackRef || "",
            item.status || "unknown",
          ]
        }),
      )

      const response = new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="repayments-${range}.csv"`,
        },
      })
      return shouldRefreshSession ? withSessionRefresh(response, user) : response
    }

    // ── kyc ──────────────────────────────────────────────────────────────────
    if (type === "kyc") {
      const kycStatusFilter = searchParams.get("status") || ""
      const kycQuery: Record<string, unknown> = {
        kycStatus: { $ne: "none" },
        ...dateMatch("createdAt", startDate, endDate),
      }
      if (["pending", "approved", "rejected"].includes(kycStatusFilter)) {
        kycQuery.kycStatus = kycStatusFilter
      }

      const kycUsers = await User.find(kycQuery)
        .select("name fullName email role kycStatus kycVerified createdAt")
        .sort({ createdAt: -1 })
        .lean()

      const csv = toCsv(
        ["Date Joined", "Name", "Email", "Role", "KYC Status", "KYC Verified"],
        kycUsers.map((u: any) => [
          u.createdAt ? new Date(u.createdAt).toISOString() : "",
          getUserName(u),
          u.email || "",
          u.role || "",
          u.kycStatus || "none",
          u.kycVerified ? "Yes" : "No",
        ]),
      )

      const response = new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="kyc-report-${range}.csv"`,
        },
      })
      return shouldRefreshSession ? withSessionRefresh(response, user) : response
    }

    // ── fleet ─────────────────────────────────────────────────────────────────
    if (type === "fleet") {
      const vehicleStatusFilter = searchParams.get("vstatus") || ""
      const vehicleQuery: Record<string, unknown> = {}
      if (["Available", "Financed", "Reserved", "Maintenance", "Retired"].includes(vehicleStatusFilter)) {
        vehicleQuery.status = vehicleStatusFilter
      }

      const vehicles = await Vehicle.find(vehicleQuery)
        .select("name identifier type year price status fundingStatus totalFundedAmount addedDate")
        .sort({ addedDate: -1 })
        .lean()

      const csv = toCsv(
        ["Date Added", "Name", "Identifier", "Type", "Year", "Price (NGN)", "Status", "Funding Status", "Total Funded (NGN)"],
        vehicles.map((v: any) => [
          v.addedDate ? new Date(v.addedDate).toISOString() : "",
          v.name || "",
          v.identifier || "",
          v.type || "",
          v.year || "",
          Number(v.price || 0),
          v.status || "",
          v.fundingStatus || "",
          Number(v.totalFundedAmount || 0),
        ]),
      )

      const response = new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="fleet-report-${range}.csv"`,
        },
      })
      return shouldRefreshSession ? withSessionRefresh(response, user) : response
    }

    // ── users ─────────────────────────────────────────────────────────────────
    const roleFilter = searchParams.get("role") || ""
    const userQuery: Record<string, unknown> = {
      ...dateMatch("createdAt", startDate, endDate),
    }
    if (["driver", "investor", "admin"].includes(roleFilter)) {
      userQuery.role = roleFilter
    }

    const platformUsers = await User.find(userQuery)
      .select("name fullName email role kycVerified createdAt")
      .sort({ createdAt: -1 })
      .lean()

    const csv = toCsv(
      ["Date Joined", "Name", "Email", "Role", "KYC Verified"],
      platformUsers.map((u: any) => [
        u.createdAt ? new Date(u.createdAt).toISOString() : "",
        getUserName(u),
        u.email || "",
        u.role || "",
        u.kycVerified ? "Yes" : "No",
      ]),
    )

    const response = new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="users-report-${range}.csv"`,
      },
    })
    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    console.error("ADMIN_REPORT_EXPORT_ERROR", error)
    return NextResponse.json({ message: "Failed to export report." }, { status: 500 })
  }
}
