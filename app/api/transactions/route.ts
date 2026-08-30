import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, normalizeUserRole, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import Transaction from "@/models/Transaction"
import { decodeCursor, encodeCursor } from "@/lib/api/cursor"

const TRANSACTION_TYPES = [
  "investment",
  "loan_disbursement",
  "repayment",
  "deposit",
  "withdrawal",
  "return",
  "pool_investment",
  "wallet_funding",
  "wallet_debit",
  "down_payment",
] as const

const querySchema = z.object({
  userId: z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid userId.").optional(),
  userType: z.enum(["admin", "driver", "investor"]).optional(),
  includeTypes: z
    .preprocess((value) => {
      if (Array.isArray(value)) {
        return value.flatMap((item) =>
          typeof item === "string" ? item.split(",").map((part) => part.trim()).filter(Boolean) : [],
        )
      }

      if (typeof value === "string") {
        return value.split(",").map((item) => item.trim()).filter(Boolean)
      }

      return []
    }, z.array(z.enum(TRANSACTION_TYPES)).max(10))
    .default([]),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  cursor: z.string().max(1000).optional(),
})

export async function GET(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin", "driver", "investor"])
    if ("response" in authContext) return authContext.response

    const query = parseSearchParams(request, querySchema)
    if ("response" in query) return query.response

    await dbConnect()

    const filter: Record<string, unknown> = {}

    if (authContext.user.role === "admin") {
      if (query.data.userId) filter.userId = query.data.userId
      if (query.data.userType) filter.userType = query.data.userType
    } else {
      filter.userId = authContext.user._id.toString()

      const currentRole = normalizeUserRole(authContext.user.role)
      if (currentRole) {
        filter.userType = currentRole
      }
    }

    if (query.data.includeTypes.length > 0) {
      filter.type = { $in: query.data.includeTypes }
    }

    const scope = JSON.stringify({ userId: filter.userId || "all", userType: filter.userType || "all", types: query.data.includeTypes })
    let cursor
    try { cursor = decodeCursor(query.data.cursor, scope) }
    catch { return NextResponse.json({ error: "Invalid or expired cursor" }, { status: 400 }) }
    if (cursor) filter.$or = [{ timestamp: { $lt: cursor.timestamp } }, { timestamp: cursor.timestamp, _id: { $lt: cursor.id } }]

    const transactions = await Transaction.find(filter)
      .select("userId userType type amount currency description status relatedId timestamp")
      .sort({ timestamp: -1, _id: -1 })
      .limit(query.data.limit + 1)
      .maxTimeMS(1500)
      .lean()

    const hasMore = transactions.length > query.data.limit
    const page = transactions.slice(0, query.data.limit)
    const last = page.at(-1)
    const nextCursor = hasMore && last ? encodeCursor({ timestamp: last.timestamp, id: String(last._id) }, scope) : null

    const response = NextResponse.json({ success: true, transactions: page, nextCursor })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("TRANSACTIONS_GET_ERROR", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
