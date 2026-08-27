import type { SnapshotEntry, Allocation } from "./types"

export interface CalculationResult {
  allocations: Allocation[]
  feeAmount: number
  reserveAmount: number
  roundingRemainder: number
}

export function calculateAllocations(
  snapshot: SnapshotEntry[],
  distributableAmount: number,
  feeBps: number,
  reserveBps: number
): CalculationResult {
  if (!Array.isArray(snapshot)) throw new Error("snapshot must be array")
  if (distributableAmount < 0) throw new Error("distributableAmount must be >= 0")
  const feeAmount = Math.floor((distributableAmount * feeBps) / 10_000)
  const reserveAmount = Math.floor((distributableAmount * reserveBps) / 10_000)

  const remaining = distributableAmount - feeAmount - reserveAmount

  const totalUnits = snapshot.reduce((s, r) => s + Math.max(0, Math.floor(r.units)), 0)

  const allocations: Allocation[] = []

  if (totalUnits === 0 || remaining <= 0) {
    const roundingRemainder = remaining
    for (const s of snapshot) {
      allocations.push({ investorId: s.investorId, amount: 0, status: "pending" })
    }
    return { allocations, feeAmount, reserveAmount, roundingRemainder }
  }

  type Frac = { investorId: string; floor: number; frac: number }
  const fracs: Frac[] = snapshot.map((s) => {
    const quota = (remaining * s.units) / totalUnits
    const fl = Math.floor(quota)
    const frac = quota - fl
    return { investorId: s.investorId, floor: fl, frac }
  })

  let allocated = fracs.reduce((s, f) => s + f.floor, 0)

  let leftover = remaining - allocated
  fracs.sort((a, b) => b.frac - a.frac || a.investorId.localeCompare(b.investorId))
  const allocMap = new Map<string, number>()
  for (const f of fracs) allocMap.set(f.investorId, f.floor)
  let idx = 0
  while (leftover > 0 && idx < fracs.length) {
    const id = fracs[idx].investorId
    allocMap.set(id, (allocMap.get(id) ?? 0) + 1)
    leftover--
    idx++
    if (idx === fracs.length && leftover > 0) idx = 0
  }

  for (const s of snapshot) {
    allocations.push({ investorId: s.investorId, amount: allocMap.get(s.investorId) ?? 0, status: "pending" })
  }

  const sumAlloc = allocations.reduce((s, a) => s + a.amount, 0)
  let roundingRemainder = distributableAmount - feeAmount - reserveAmount - sumAlloc
  return { allocations, feeAmount, reserveAmount, roundingRemainder }
}

export default { calculateAllocations }
