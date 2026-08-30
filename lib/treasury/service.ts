/** Treasury calculations deliberately use integer minor units only. */
export const TREASURY_BUCKETS = ["available_cash", "restricted_escrow", "settlement_in_transit", "investor_payable", "refund_payable", "platform_reserve", "fees", "suspense"] as const
export type TreasuryBucket = (typeof TREASURY_BUCKETS)[number]
export type TreasuryPolicy = { minimumReserveMinor: number; maxSingleObligationMinor?: number }
export type TreasuryPosition = { buckets: Record<TreasuryBucket, number>; availableLiquidityMinor: number; requiredLiquidityMinor: number; varianceMinor: number; severity: "normal" | "warning" | "critical"; explanations: string[] }

export function assertMinor(value: number, name = "amount") {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer minor-unit amount.`)
}

export function calculateTreasuryPosition(input: Partial<Record<TreasuryBucket, number>>, policy: TreasuryPolicy): TreasuryPosition {
  assertMinor(policy.minimumReserveMinor, "minimumReserveMinor")
  const buckets = Object.fromEntries(TREASURY_BUCKETS.map((bucket) => [bucket, input[bucket] ?? 0])) as Record<TreasuryBucket, number>
  for (const [bucket, amount] of Object.entries(buckets)) assertMinor(amount, bucket)
  // Escrow, provider-pending cash, and fees are deliberately excluded from free liquidity.
  const availableLiquidityMinor = buckets.available_cash - buckets.settlement_in_transit
  const requiredLiquidityMinor = buckets.investor_payable + buckets.refund_payable + buckets.platform_reserve + policy.minimumReserveMinor
  const varianceMinor = availableLiquidityMinor - requiredLiquidityMinor
  const explanations = [
    `Restricted escrow excluded: ${buckets.restricted_escrow}.`,
    `Provider settlements in transit excluded: ${buckets.settlement_in_transit}.`,
    `Required obligations include investor payables, refund payables, reserve, and policy minimum.`,
  ]
  return { buckets, availableLiquidityMinor, requiredLiquidityMinor, varianceMinor, severity: varianceMinor < 0 ? "critical" : varianceMinor < policy.minimumReserveMinor ? "warning" : "normal", explanations }
}

export function decideTreasuryHold(position: TreasuryPosition, amountMinor: number, policy: TreasuryPolicy) {
  assertMinor(amountMinor)
  if (policy.maxSingleObligationMinor !== undefined && amountMinor > policy.maxSingleObligationMinor) return { approved: false, code: "CONCENTRATION_LIMIT", reason: "Obligation exceeds the configured concentration limit." } as const
  if (position.availableLiquidityMinor - amountMinor < position.requiredLiquidityMinor) return { approved: false, code: "RESERVE_BREACH", reason: "Operation is held because it would breach the liquidity reserve." } as const
  return { approved: true } as const
}
