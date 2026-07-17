import InvestmentPool from "@/models/InvestmentPool"
import PoolInvestment from "@/models/PoolInvestment"
import ProcessedGatewayEvent from "@/models/ProcessedGatewayEvent"
import Transaction from "@/models/Transaction"
import User from "@/models/User"

export async function expectWalletLedgerBalanced(userId: string) {
  const [user, rows] = await Promise.all([
    User.findById(userId).lean(),
    Transaction.find({ userId, status: "Completed" }).lean(),
  ])
  if (!user) throw new Error("Invariant failed: user is missing")
  const credited = rows.filter(row => row.type === "wallet_funding").reduce((sum, row) => sum + Number(row.amount), 0)
  const invested = rows.filter(row => row.type === "pool_investment").reduce((sum, row) => sum + Number(row.amount), 0)
  expect(Number(user.availableBalance)).toBe(credited - invested)
}

export async function expectPoolCapacityInvariant(poolId: string) {
  const [pool, investments] = await Promise.all([
    InvestmentPool.findById(poolId).lean(),
    PoolInvestment.find({ poolId, status: "CONFIRMED" }).lean(),
  ])
  if (!pool) throw new Error("Invariant failed: pool is missing")
  const invested = investments.reduce((sum, row) => sum + Number(row.amountNgn), 0)
  expect(pool.currentRaisedNgn).toBe(invested)
  expect(pool.currentRaisedNgn).toBeLessThanOrEqual(pool.targetAmountNgn)
}

export async function expectGatewayReferenceCreditedOnce(reference: string) {
  expect(await ProcessedGatewayEvent.countDocuments({ _id: reference })).toBe(1)
  expect(await Transaction.countDocuments({ gatewayReference: reference, status: "Completed" })).toBe(1)
}
