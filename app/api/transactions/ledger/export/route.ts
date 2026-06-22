import { NextResponse } from "next/server"
import { z } from "zod"

import { normalizeUserRole, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import {
  buildLedgerFilter,
  normalizeLedgerEntry,
  type LedgerActor,
  type LedgerQueryParams,
} from "@/lib/ledger/ledger"
import Transaction from "@/models/Transaction"
import "@/models/User"

const EXPORT_LIMIT = 5000

const querySchema = z.object({
  search: z.string().trim().max(120).default(""),
  type: z.string().trim().max(40).default(""),
  status: z.string().trim().max(20).default(""),
  method: z.string().trim().max(40).default(""),
  reconciliation: z.enum(["reconciled", "pending", "failed", "duplicate", ""]).default(""),
  from: z.string().trim().max(40).default(""),
  to: z.string().trim().max(40).default(""),
  userType: z.string().trim().max(20).default(""),
  userId: z.string().trim().max(40).default(""),
})

function csvEscape(value: unknown): string {
  const raw = value == null ? "" : String(value)
  if (raw.includes(",") || raw.includes("\"") || raw.includes("\n")) {
    return `"${raw.replace(/"/g, "\"\"")}"`
  }
  return raw
}

export async function GET(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin", "driver", "investor"])
    if ("response" in authContext) return authContext.response

    const parsed = parseSearchParams(request, querySchema)
    if ("response" in parsed) return parsed.response

    const role = normalizeUserRole(authContext.user.role)
    if (!role) {
      return NextResponse.json({ message: "Access denied" }, { status: 403 })
    }

    await dbConnect()

    const params = { ...parsed.data, page: 1, pageSize: EXPORT_LIMIT } as LedgerQueryParams
    const actor: LedgerActor = { id: authContext.user._id.toString(), role }
    const isAdmin = role === "admin"

    const baseFilter = buildLedgerFilter(params, actor)

    const duplicateAgg = await Transaction.aggregate([
      { $match: { ...baseFilter, gatewayReference: { $nin: [null, ""] } } },
      { $group: { _id: "$gatewayReference", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $project: { _id: 1 } },
    ])
    const duplicateReferences = new Set<string>(duplicateAgg.map((entry: { _id: string }) => entry._id))

    const queryFilter: Record<string, unknown> = { ...baseFilter }
    if (params.reconciliation === "failed") {
      queryFilter.status = "Failed"
    } else if (params.reconciliation === "pending") {
      queryFilter.status = "Pending"
    } else if (params.reconciliation === "duplicate") {
      queryFilter.gatewayReference = { $in: Array.from(duplicateReferences) }
    } else if (params.reconciliation === "reconciled") {
      queryFilter.status = "Completed"
      queryFilter.gatewayReference = { $nin: Array.from(duplicateReferences) }
    }

    const pageQuery = Transaction.find(queryFilter).sort({ timestamp: -1 }).limit(EXPORT_LIMIT)
    if (isAdmin) {
      pageQuery.populate({ path: "userId", select: "name fullName email role" })
    }
    const transactions = (await pageQuery.lean()) as Array<Record<string, any>>

    const headers = [
      "Date",
      "Type",
      "Direction",
      "Amount",
      "Currency",
      "Status",
      "Reconciliation",
      "Method",
      "Reference",
      "Description",
      ...(isAdmin ? ["User", "User Email", "User Type"] : []),
    ]

    const lines = [headers.map(csvEscape).join(",")]
    for (const tx of transactions) {
      const entry = normalizeLedgerEntry(tx, duplicateReferences)
      const row = [
        entry.timestamp,
        entry.type,
        entry.direction,
        entry.amount,
        entry.currency,
        entry.status,
        entry.reconciliation,
        entry.method ?? "",
        entry.reference ?? "",
        entry.description,
        ...(isAdmin ? [entry.userName ?? "", entry.userEmail ?? "", entry.userType] : []),
      ]
      lines.push(row.map(csvEscape).join(","))
    }

    const csv = lines.join("\n")
    const filename = `transaction-ledger-${new Date().toISOString().slice(0, 10)}.csv`

    return new NextResponse(csv, {
      status: 200,
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    })
  } catch (error) {
    console.error("LEDGER_EXPORT_ERROR", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
