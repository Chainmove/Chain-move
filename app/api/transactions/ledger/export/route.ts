import { NextResponse } from "next/server"
import { z } from "zod"

import { normalizeUserRole, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import { createCsvStream } from "@/lib/exports/csv-stream"
import {
  buildLedgerFilter,
  normalizeLedgerEntry,
  type LedgerActor,
  type LedgerQueryParams,
} from "@/lib/ledger/ledger"
import Transaction from "@/models/Transaction"
import "@/models/User"

const CURSOR_BATCH_SIZE = 250

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

    const params = { ...parsed.data, page: 1, pageSize: CURSOR_BATCH_SIZE } as LedgerQueryParams
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

    // `_id` breaks timestamp ties, so the cursor has a deterministic order even
    // while new transactions are being written after the export has started.
    const pageQuery = Transaction.find(queryFilter).sort({ timestamp: -1, _id: -1 })
    if (isAdmin) {
      pageQuery.populate({ path: "userId", select: "name fullName email role" })
    }

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

    async function* rows(): AsyncGenerator<unknown[]> {
      const cursor = pageQuery.lean().cursor({ batchSize: CURSOR_BATCH_SIZE })
      for await (const tx of cursor as AsyncIterable<Record<string, any>>) {
        const entry = normalizeLedgerEntry(tx, duplicateReferences)
        yield [
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
      }
    }

    const filename = `transaction-ledger-${new Date().toISOString().slice(0, 10)}.csv`

    return new NextResponse(createCsvStream(headers, rows()), {
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
