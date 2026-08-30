import { InvestmentListQuerySchema, InvestmentListResponseSchema } from "@/lib/api/contracts"
import { defineRoute } from "@/lib/api/route-handler"
import { money, serializeDateTime, serializeId } from "@/lib/api/serialization"
import dbConnect from "@/lib/dbConnect"
import Investment from "@/models/Investment"

export const GET = defineRoute({
  operationId: "listInvestments",
  method: "GET",
  auth: "authenticated",
  action: "investment:read",
  query: InvestmentListQuerySchema,
  // Admins may scope to any investor; everyone else is pinned to their own id,
  // so the policy engine sees an ownership match only when it should.
  resource: ({ user, query }) => ({
    type: "investment",
    ownerId: user.role === "admin" && query.investorId ? query.investorId : String(user._id),
  }),
  response: InvestmentListResponseSchema,
  successStatus: 200,
  handler: async ({ user, query }) => {
    await dbConnect()

    const isAdmin = user.role === "admin"
    const investorId = isAdmin && query.investorId ? query.investorId : String(user._id)
    const filter = isAdmin && !query.investorId ? {} : { investorId }

    const investments = await Investment.find(filter).sort({ date: -1 }).lean()

    return {
      success: true as const,
      investments: investments.map((investment) => ({
        id: serializeId(investment._id) as string,
        investorId: serializeId(investment.investorId),
        loanId: serializeId(investment.loanId),
        vehicleId: serializeId(investment.vehicleId),
        amount: money(Number(investment.amount) || 0),
        monthlyReturn: money(Number(investment.monthlyReturn) || 0),
        status: String(investment.status ?? "Unknown"),
        date: serializeDateTime(investment.date),
      })),
    }
  },
})
