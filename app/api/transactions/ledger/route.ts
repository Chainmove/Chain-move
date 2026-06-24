import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, normalizeUserRole, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import {
  buildLedgerFilter,
  normalizeLedgerEntry,
  type LedgerActor,
  type LedgerQueryParams,
} from "@/lib/ledger/ledger"
import Transaction from "@/models/Transaction"
// Ensure the referenced model is registered for populate().
import "@/models/User"

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
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

    const params = parsed.data as LedgerQueryParams
    const actor: LedgerActor = { id: authContext.user._id.toString(), role }
    const isAdmin = role === "admin"

    const baseFilter = buildLedgerFilter(params, actor)

    // Detect duplicate provider references within the filtered scope so the
    // dashboard can flag potential double-postings.
    const duplicateAgg = await Transaction.aggregate([
      { $match: { ...baseFilter, gatewayReference: { $nin: [null, ""] } } },
      { $group: { _id: "$gatewayReference", count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $project: { _id: 1 } },
    ])
    const duplicateReferences = new Set<string>(duplicateAgg.map((entry: { _id: string }) => entry._id))

    // Translate the derived reconciliation filter into a concrete query clause.
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

    const pageQuery = Transaction.find(queryFilter)
      .sort({ timestamp: -1 })
      .skip((params.page - 1) * params.pageSize)
      .limit(params.pageSize)
    if (isAdmin) {
      pageQuery.populate({ path: "userId", select: "name fullName email role" })
    }

    const [statusAgg, total, transactions] = await Promise.all([
      Transaction.aggregate([
        { $match: baseFilter },
        { $group: { _id: "$status", count: { $sum: 1 }, amount: { $sum: "$amount" } } },
      ]),
      Transaction.countDocuments(queryFilter),
      pageQuery.lean(),
    ])

    const statusMap = new Map<string, { count: number; amount: number }>()
    for (const entry of statusAgg as Array<{ _id: string; count: number; amount: number }>) {
      statusMap.set(entry._id, { count: entry.count, amount: entry.amount })
    }

    const completed = statusMap.get("Completed") ?? { count: 0, amount: 0 }
    const pending = statusMap.get("Pending") ?? { count: 0, amount: 0 }
    const failed = statusMap.get("Failed") ?? { count: 0, amount: 0 }
    const totalCount = completed.count + pending.count + failed.count

    const entries = (transactions as Array<Record<string, any>>).map((tx) =>
      normalizeLedgerEntry(tx, duplicateReferences),
    )

    const response = NextResponse.json({
      success: true,
      scope: isAdmin ? "global" : "self",
      transactions: entries,
      pagination: {
        page: params.page,
        pageSize: params.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
      },
      summary: {
        totalCount,
        totalAmount: completed.amount + pending.amount + failed.amount,
        completedCount: completed.count,
        completedAmount: completed.amount,
        pendingCount: pending.count,
        pendingAmount: pending.amount,
        failedCount: failed.count,
        failedAmount: failed.amount,
        duplicateCount: duplicateReferences.size,
      },
    })

    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("LEDGER_GET_ERROR", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
