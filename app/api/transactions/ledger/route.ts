import { LedgerListQuerySchema, LedgerListResponseSchema } from "@/lib/api/contracts"
import { ApiError } from "@/lib/api/errors"
import { buildPaginationMeta } from "@/lib/api/pagination"
import { defineRoute } from "@/lib/api/route-handler"
import { money } from "@/lib/api/serialization"
import { normalizeUserRole } from "@/lib/api/route-guard"
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

export const GET = defineRoute({
  operationId: "listLedgerTransactions",
  method: "GET",
  auth: "authenticated",
  roles: ["admin", "driver", "investor"],
  query: LedgerListQuerySchema,
  response: LedgerListResponseSchema,
  successStatus: 200,
  handler: async ({ user, query }) => {
    const role = normalizeUserRole(user.role)
    if (!role) throw ApiError.forbidden()

    await dbConnect()

    const isAdmin = role === "admin"

    // `buildLedgerFilter` predates the contract layer and reads empty strings
    // as "no filter", so optional values are flattened back to that form.
    const params: LedgerQueryParams = {
      page: query.page,
      pageSize: query.pageSize,
      search: query.search ?? "",
      type: query.type ?? "",
      status: query.status ?? "",
      method: query.method ?? "",
      reconciliation: query.reconciliation ?? "",
      from: query.from ?? "",
      to: query.to ?? "",
      userType: isAdmin ? query.userType ?? "" : "",
      userId: isAdmin ? query.userId ?? "" : "",
    } as LedgerQueryParams

    const actor: LedgerActor = { id: String(user._id), role }
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
      .skip((query.page - 1) * query.pageSize)
      .limit(query.pageSize)
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

    const entries = (transactions as Array<Record<string, any>>).map((transaction) => {
      const entry = normalizeLedgerEntry(transaction, duplicateReferences)

      return {
        id: entry.id,
        userId: entry.userId,
        userType: entry.userType,
        userName: entry.userName,
        userEmail: entry.userEmail,
        type: entry.type,
        direction: entry.direction,
        amount: money(entry.amount, entry.currency),
        originalAmount:
          entry.amountOriginal != null
            ? money(entry.amountOriginal, entry.originalCurrency || entry.currency)
            : null,
        exchangeRate: entry.exchangeRate,
        method: entry.method,
        reference: entry.reference,
        description: entry.description,
        status: entry.status as "Pending" | "Completed" | "Failed",
        reconciliation: entry.reconciliation,
        relatedId: entry.relatedId,
        timestamp: entry.timestamp,
        // `metadata` is deliberately dropped: it holds raw provider payloads.
        // See docs/api-migration.md.
      }
    })

    return {
      success: true as const,
      scope: (isAdmin ? "global" : "self") as "global" | "self",
      transactions: entries,
      pagination: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
      summary: {
        totalCount: completed.count + pending.count + failed.count,
        totalAmount: money(completed.amount + pending.amount + failed.amount),
        completedCount: completed.count,
        completedAmount: money(completed.amount),
        pendingCount: pending.count,
        pendingAmount: money(pending.amount),
        failedCount: failed.count,
        failedAmount: money(failed.amount),
        duplicateCount: duplicateReferences.size,
      },
    }
  },
})
