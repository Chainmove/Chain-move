import { describe, expect, it } from "vitest"
import { calculateOwnership, isValidReservationTransition } from "@/lib/services/investments.service"

describe("pool investment reservation state machine", () => {
  it("permits only explicit reservation transitions", () => {
    expect(isValidReservationTransition("PENDING", "RESERVED")).toBe(true)
    expect(isValidReservationTransition("RESERVED", "SETTLED")).toBe(true)
    expect(isValidReservationTransition("RESERVED", "EXPIRED")).toBe(true)
    expect(isValidReservationTransition("SETTLED", "EXPIRED")).toBe(false)
    expect(isValidReservationTransition("EXPIRED", "SETTLED")).toBe(false)
  })

  it("allocates ownership deterministically for 20 parallel command amounts", () => {
    const amounts = Array.from({ length: 20 }, () => 50_000)
    const ownership = amounts.map((amount) => calculateOwnership(amount, 1_000_000))
    expect(ownership.every(({ ownershipUnits, ownershipBps }) => ownershipUnits === 50_000 && ownershipBps === 500)).toBe(true)
  })
})
