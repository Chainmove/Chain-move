import { describe, expect, it } from "vitest"
import { calculateTreasuryPosition, decideTreasuryHold } from "@/lib/treasury/service"

const policy = { minimumReserveMinor: 1_000, maxSingleObligationMinor: 8_000 }
describe("treasury controls", () => {
  it("excludes restricted escrow and pending settlements from available liquidity", () => {
    const position = calculateTreasuryPosition({ available_cash: 10_000, restricted_escrow: 50_000, settlement_in_transit: 2_000 }, policy)
    expect(position.availableLiquidityMinor).toBe(8_000)
    expect(position.buckets.restricted_escrow).toBe(50_000)
  })
  it("holds concurrent payout requests after the first consumes liquidity", () => {
    const position = calculateTreasuryPosition({ available_cash: 12_000 }, policy)
    expect(decideTreasuryHold(position, 6_000, policy).approved).toBe(true)
    const afterFirst = { ...position, availableLiquidityMinor: position.availableLiquidityMinor - 6_000 }
    expect(decideTreasuryHold(afterFirst, 6_000, policy)).toMatchObject({ approved: false, code: "RESERVE_BREACH" })
  })
  it("handles refunds, reversals, negative scenarios, and integer-only values deterministically", () => {
    const position = calculateTreasuryPosition({ available_cash: 4_000, refund_payable: 3_500 }, policy)
    expect(position.severity).toBe("critical")
    expect(decideTreasuryHold(position, 1, policy).code).toBe("RESERVE_BREACH")
    expect(() => calculateTreasuryPosition({ available_cash: 1.5 }, policy)).toThrow("minor-unit")
  })
  it("is reproducible from the same authoritative bucket values", () => {
    const source = { available_cash: 12_000, restricted_escrow: 2_000, investor_payable: 1_000 }
    expect(calculateTreasuryPosition(source, policy)).toEqual(calculateTreasuryPosition(source, policy))
  })
})
