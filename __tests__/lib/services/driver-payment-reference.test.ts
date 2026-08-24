// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/models/DriverPayment")
vi.mock("@/models/HirePurchaseContract")
vi.mock("@/models/InvestorCredit")
vi.mock("@/models/PoolInvestment")
vi.mock("@/models/Transaction")
vi.mock("@/models/User")

import DriverPayment from "@/models/DriverPayment"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import { createDriverPayment } from "@/lib/services/driver-contracts.service"

const CONTRACT_ID = "507f1f77bcf86cd799439011"
const DRIVER_ID = "507f1f77bcf86cd799439012"

function duplicateKeyError(field: string) {
  const error = new Error(`E11000 duplicate key error: ${field}`) as Error & {
    code: number
    keyPattern: Record<string, number>
  }
  error.code = 11000
  error.keyPattern = { [field]: 1 }
  return error
}

function activeContract() {
  return {
    _id: CONTRACT_ID,
    driverUserId: DRIVER_ID,
    status: "ACTIVE",
    totalPayableNgn: 100_000,
    totalPaidNgn: 20_000,
  }
}

function paymentFixture(overrides: Record<string, unknown> = {}) {
  return {
    _id: "p1",
    contractId: CONTRACT_ID,
    driverUserId: DRIVER_ID,
    amountNgn: 5_000,
    appliedAmountNgn: 0,
    createdAt: new Date(),
    ...overrides,
  }
}

const baseInput = {
  contractId: CONTRACT_ID,
  driverUserId: DRIVER_ID,
  amountNgn: 5_000,
}

describe("createDriverPayment — payment reference collision handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(HirePurchaseContract.findOne).mockResolvedValue(activeContract() as any)
  })

  it("retries with a fresh generated reference on a paystackRef-only collision and succeeds within the bound", async () => {
    const createdPayment = paymentFixture({ paystackRef: "cm_driver_repay_v1_final" })
    vi.mocked(DriverPayment.create)
      .mockRejectedValueOnce(duplicateKeyError("paystackRef"))
      .mockRejectedValueOnce(duplicateKeyError("paystackRef"))
      .mockResolvedValueOnce(createdPayment as any)

    const result = await createDriverPayment(baseInput)

    expect(result.id).toBe("p1")
    expect(DriverPayment.create).toHaveBeenCalledTimes(3)

    const referencesUsed = vi.mocked(DriverPayment.create).mock.calls.map((call) => (call[0] as any).paystackRef)
    expect(new Set(referencesUsed).size).toBe(3)
    referencesUsed.forEach((ref) => expect(ref).toMatch(/^cm_driver_repay_v1_/))
  })

  it("is bounded: gives up after exactly 3 attempts", async () => {
    vi.mocked(DriverPayment.create).mockRejectedValue(duplicateKeyError("paystackRef"))

    await expect(createDriverPayment(baseInput)).rejects.toThrow(/unique payment reference after 3 attempts/i)
    expect(DriverPayment.create).toHaveBeenCalledTimes(3)
  })

  it("logs each collision retry for observability", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    vi.mocked(DriverPayment.create)
      .mockRejectedValueOnce(duplicateKeyError("paystackRef"))
      .mockResolvedValueOnce(paymentFixture({ _id: "p2", paystackRef: "ok" }) as any)

    await createDriverPayment(baseInput)

    expect(warnSpy).toHaveBeenCalledWith(
      "DRIVER_PAYMENT_REFERENCE_COLLISION_RETRY",
      expect.objectContaining({ attempt: 1, contractId: CONTRACT_ID, driverUserId: DRIVER_ID }),
    )
    warnSpy.mockRestore()
  })

  it("does not retry when the caller supplied their own paystackRef — a collision there is a real conflict", async () => {
    vi.mocked(DriverPayment.create).mockRejectedValueOnce(duplicateKeyError("paystackRef"))

    await expect(
      createDriverPayment({ ...baseInput, paystackRef: "caller-chosen-ref" }),
    ).rejects.toMatchObject({ code: 11000 })

    // No retry loop: exactly the caller's own reference was attempted once.
    expect(DriverPayment.create).toHaveBeenCalledTimes(1)
    expect((vi.mocked(DriverPayment.create).mock.calls[0][0] as any).paystackRef).toBe("caller-chosen-ref")
  })

  it("does not swallow an unrelated duplicate-key error (e.g. a different unique index)", async () => {
    vi.mocked(DriverPayment.create).mockRejectedValueOnce(duplicateKeyError("someOtherField"))

    await expect(createDriverPayment(baseInput)).rejects.toMatchObject({ code: 11000 })
    expect(DriverPayment.create).toHaveBeenCalledTimes(1)
  })
})
