import {
  PoolInvestParamsSchema,
  PoolInvestmentRequestSchema,
  PoolInvestmentResponseSchema,
} from "@/lib/api/contracts"
import { ApiError } from "@/lib/api/errors"
import { defineRoute } from "@/lib/api/route-handler"
import { money } from "@/lib/api/serialization"
import { investInPool } from "@/lib/services/investments.service"

/**
 * Service rule violations arrive as plain `Error`s. Each is mapped to a stable
 * code with authored copy; the service message itself is never forwarded,
 * because it may name internal state or record ids.
 */
function mapInvestmentError(error: unknown): never {
  if (!(error instanceof Error)) throw error

  const message = error.message.toLowerCase()

  if (message.includes("not found")) {
    throw ApiError.notFound("Pool not found.")
  }

  if (message.includes("insufficient")) {
    throw ApiError.unprocessable("Your wallet balance is not enough for this contribution.", [
      { path: "amountNgn", message: "Exceeds available wallet balance." },
    ])
  }

  if (message.includes("closed") || message.includes("funded") || message.includes("status")) {
    throw ApiError.conflict("This pool is no longer accepting contributions.")
  }

  if (message.includes("minimum") || message.includes("exceed") || message.includes("amount")) {
    throw ApiError.unprocessable("The contribution amount is not valid for this pool.", [
      { path: "amountNgn", message: "Outside the pool's accepted contribution range." },
    ])
  }

  throw error
}

export const POST = defineRoute({
  operationId: "investInPool",
  method: "POST",
  auth: "authenticated",
  roles: ["investor", "admin"],
  params: PoolInvestParamsSchema,
  body: PoolInvestmentRequestSchema,
  response: PoolInvestmentResponseSchema,
  successStatus: 201,
  handler: async ({ user, params, body }) => {
    try {
      const investment = await investInPool({
        poolId: params.poolId,
        userId: String(user._id),
        amountNgn: body.amountNgn,
        txRef: body.txRef,
        consentAcceptanceId: body.consentAcceptanceId,
        jurisdiction: body.jurisdiction,
        role: (user.role as "driver" | "investor" | "admin") || "investor",
      })

      return {
        success: true as const,
        investment: {
          poolId: investment.poolId,
          userId: investment.userId,
          amount: money(investment.amountNgn),
          ownershipUnits: investment.ownershipUnits,
          ownershipBps: investment.ownershipBps,
          txRef: investment.txRef,
          consentAcceptanceId: investment.consentAcceptanceId,
          acceptedDocumentSetHash: investment.acceptedDocumentSetHash,
          poolStatus: investment.poolStatus as "OPEN" | "FUNDED" | "CLOSED",
          currentRaised: money(investment.currentRaisedNgn),
          targetAmount: money(investment.targetAmountNgn),
          investorCount: investment.investorCount,
          userBalance: money(investment.userBalanceNgn),
        },
      }
    } catch (error) {
      // Transient Mongo transaction failures are already mapped to a retryable
      // 503 by `normalizeError`, so `mapInvestmentError` rethrows them intact.
      return mapInvestmentError(error)
    }
  },
})
