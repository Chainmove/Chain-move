import { NextResponse } from "next/server"
import { z } from "zod"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { parseJsonBody } from "@/lib/api/validation"
import { investInPool } from "@/lib/services/investments.service"

const investmentRequestSchema = z
  .object({
    amountNgn: z.preprocess((value) => Number(value), z.number().positive().max(100_000_000)),
    txRef: z.string().trim().max(128).optional(),
  })
  .strict()

function isTransientTransactionError(error: unknown) {
  if (!error || typeof error !== "object") return false

  const maybeMongoError = error as {
    code?: number
    codeName?: string
    errorLabels?: string[]
    message?: string
  }

  const labels = Array.isArray(maybeMongoError.errorLabels) ? maybeMongoError.errorLabels : []
  const message = typeof maybeMongoError.message === "string" ? maybeMongoError.message : ""

  return (
    maybeMongoError.code === 251 ||
    maybeMongoError.codeName === "NoSuchTransaction" ||
    labels.includes("TransientTransactionError") ||
    /does not match any in-progress transactions/i.test(message)
  )
}

export async function POST(request: Request, context: { params: Promise<{ poolId: string }> }) {
  try {
    const { user, shouldRefreshSession } = await getAuthenticatedUser(request)
    if (!user) {
      return NextResponse.json({ message: "Unauthorized" }, { status: 401 })
    }

    if (!["investor", "admin"].includes(user.role)) {
      return NextResponse.json({ message: "Only investors or admins can invest in pools." }, { status: 403 })
    }

    const body = await parseJsonBody(request, investmentRequestSchema)
    if ("response" in body) return body.response

    const amountNgn = body.data.amountNgn
    const { poolId } = await context.params

    const investment = await investInPool({
      poolId,
      userId: user._id.toString(),
      amountNgn,
      txRef: body.data.txRef,
    })

    const response = NextResponse.json({ success: true, investment }, { status: 201 })
    return shouldRefreshSession ? withSessionRefresh(response, user) : response
  } catch (error) {
    if (isTransientTransactionError(error)) {
      return NextResponse.json(
        { message: "Temporary transaction conflict. Please retry your investment." },
        { status: 503 },
      )
    }

    const message = error instanceof Error ? error.message : "Failed to invest in pool."
    console.error("POOL_INVEST_ERROR", error)
    return NextResponse.json({ message }, { status: 400 })
  }
}
