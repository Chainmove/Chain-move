import { WalletSummaryResponseSchema } from "@/lib/api/contracts"
import { defineRoute } from "@/lib/api/route-handler"
import { money, serializeDateTime, serializeId } from "@/lib/api/serialization"
import Transaction from "@/models/Transaction"

const WALLET_TRANSACTION_TYPES = ["deposit", "wallet_funding", "pool_investment", "wallet_debit"]

export const GET = defineRoute({
  operationId: "getWalletSummary",
  method: "GET",
  auth: "authenticated",
  action: "wallet:read",
  resource: ({ user }) => ({ type: "wallet", ownerId: String(user._id) }),
  response: WalletSummaryResponseSchema,
  successStatus: 200,
  handler: async ({ user }) => {
    const transactions = await Transaction.find({
      userId: user._id,
      type: { $in: WALLET_TRANSACTION_TYPES },
    })
      .sort({ timestamp: -1 })
      .limit(20)
      .lean()

    return {
      success: true as const,
      wallet: {
        internalBalance: money(Number(user.availableBalance) || 0),
        walletAddress: (user.walletAddress as string) || (user.walletaddress as string) || null,
      },
      transactions: transactions.map((transaction) => ({
        id: serializeId(transaction._id) as string,
        type: transaction.type,
        amount: money(Number(transaction.amount) || 0, transaction.currency || "NGN"),
        status: transaction.status ?? "Completed",
        method: transaction.method ?? null,
        description: transaction.description ?? "",
        reference: transaction.gatewayReference ?? null,
        timestamp: serializeDateTime(transaction.timestamp) ?? new Date().toISOString(),
      })),
    }
  },
})
