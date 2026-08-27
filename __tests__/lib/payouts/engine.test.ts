import { describe, it, expect, beforeEach } from "vitest"
import DistributionService from "../../../lib/payouts/service"
import { calculateAllocations } from "../../../lib/payouts/engine"

class MockProvider {
  calls: Array<{ investorId: string; amount: number }> = []
  failures = new Set<string>()
  async postPayment(investorId: string, amount: number) {
    this.calls.push({ investorId, amount })
    if (this.failures.has(investorId)) {
      return { success: false, error: "simulated failure" }
    }
    return { success: true, txId: `tx-${investorId}-${amount}` }
  }
}

describe("payout engine calculations", () => {
  it("allocates by largest remainder and balances totals", () => {
    const snapshot = [
      { investorId: "A", units: 1 },
      { investorId: "B", units: 1 },
    ]
    const res = calculateAllocations(snapshot, 101, 0, 0)
    const sum = res.allocations.reduce((s, a) => s + a.amount, 0) + res.feeAmount + res.reserveAmount + res.roundingRemainder
    expect(sum).toBe(101)
    const a = res.allocations.find((x) => x.investorId === "A")!
    const b = res.allocations.find((x) => x.investorId === "B")!
    expect(a.amount).toBeGreaterThanOrEqual(b.amount)
  })

  it("is deterministic across runs with same snapshot", () => {
    const snapshot = [{ investorId: "X", units: 3 }, { investorId: "Y", units: 7 }]
    const a = calculateAllocations(snapshot, 1_000_00, 150, 50)
    const b = calculateAllocations(snapshot, 1_000_00, 150, 50)
    expect(a.allocations.map((x) => x.amount)).toEqual(b.allocations.map((x) => x.amount))
    expect(a.feeAmount).toBe(b.feeAmount)
    expect(a.reserveAmount).toBe(b.reserveAmount)
  })
})

describe("DistributionService execution and lifecycle", () => {
  let provider: MockProvider
  let svc: any

  beforeEach(() => {
    provider = new MockProvider()
    svc = new DistributionService(provider)
  })

  it("prevents re-execution from double-paying (idempotent) and supports partial failures + retry", async () => {
    const snapshot = [{ investorId: "u1", units: 2 }, { investorId: "u2", units: 1 }]
    const d = svc.createDraft({ poolId: "p1", snapshot, distributableAmount: 300, createdBy: "maker" })
    svc.calculate(d.id)
    svc.approve(d.id, "checker", "maker")
    

    provider.failures.add("u2")
    const res1 = await svc.execute(d.id)
    expect(res1.state).toBe("partially_failed")
    const allocU1 = res1.allocations.find((a: any) => a.investorId === "u1")
    const allocU2 = res1.allocations.find((a: any) => a.investorId === "u2")
    expect(allocU1.status).toBe("paid")
    expect(allocU2.status).toBe("failed")
    expect(provider.calls.length).toBe(2)

    provider.failures.delete("u2")
    const retry = await svc.retryRecipient(d.id, "u2")
    expect(retry.status).toBe("paid")
    const after = svc.get(d.id)
    expect(after.state).toBe("paid")

    const beforeCalls = provider.calls.length
    await svc.execute(d.id)
    expect(provider.calls.length).toBe(beforeCalls)
  })

  it("reversal marks paid allocations as held and prevents double reverse", async () => {
    const snapshot = [{ investorId: "a", units: 1 }]
    const d = svc.createDraft({ poolId: "p", snapshot, distributableAmount: 100, createdBy: "maker" })
    svc.calculate(d.id)
    svc.approve(d.id, "checker", "maker")
    await svc.execute(d.id)
    expect(svc.get(d.id).state).toBe("paid")
    svc.reverse(d.id)
    expect(svc.get(d.id).state).toBe("reversed")
    expect(() => svc.reverse(d.id)).toThrow()
  })
})
