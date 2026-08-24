// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest"
import mongoose from "mongoose"

vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/models/SettlementRecord")
vi.mock("@/models/AuditLog")
vi.mock("@/models/Transaction")
vi.mock("@/models/User")

import SettlementRecord from "@/models/SettlementRecord"
import User from "@/models/User"
import { initiateSettlement } from "@/lib/settlement/settlement-service"

function duplicateKeyError(field: string) {
  const error = new Error(`E11000 duplicate key error: ${field}`) as Error & {
    code: number
    keyPattern: Record<string, number>
  }
  error.code = 11000
  error.keyPattern = { [field]: 1 }
  return error
}

function fakeSession() {
  return {
    startTransaction: vi.fn(),
    commitTransaction: vi.fn().mockResolvedValue(undefined),
    abortTransaction: vi.fn().mockResolvedValue(undefined),
    endSession: vi.fn(),
  }
}

const baseInput = {
  rail: "paystack" as const,
  providerReference: "prov-ref-1",
  userId: "507f1f77bcf86cd799439011",
  userType: "driver" as const,
  paymentType: "driver_repayment" as const,
  amount: 5000,
}

describe("initiateSettlement — settlement id collision handling", () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    vi.mocked(SettlementRecord.findOne).mockResolvedValue(null as any)
    vi.mocked(User.findByIdAndUpdate).mockResolvedValue(undefined as any)
  })

  it("retries with a fresh settlementId on a settlementId-only collision and succeeds within the bound", async () => {
    const session = fakeSession()
    vi.spyOn(mongoose, "startSession").mockResolvedValue(session as any)

    const createdRecord = { settlementId: "STL-v1-x-final", rail: "paystack" }
    vi.mocked(SettlementRecord.create)
      .mockRejectedValueOnce(duplicateKeyError("settlementId"))
      .mockRejectedValueOnce(duplicateKeyError("settlementId"))
      .mockResolvedValueOnce([createdRecord] as any)

    const result = await initiateSettlement(baseInput)

    expect(result.alreadyExists).toBe(false)
    expect(result.settlement).toEqual(createdRecord)
    expect(SettlementRecord.create).toHaveBeenCalledTimes(3)

    // Each attempt used a different generated settlementId.
    const settlementIdsUsed = vi.mocked(SettlementRecord.create).mock.calls.map(
      (call) => (call[0] as any)[0].settlementId,
    )
    expect(new Set(settlementIdsUsed).size).toBe(3)

    expect(session.startTransaction).toHaveBeenCalledTimes(3)
    expect(session.abortTransaction).toHaveBeenCalledTimes(2)
    expect(session.commitTransaction).toHaveBeenCalledTimes(1)
    expect(session.endSession).toHaveBeenCalledTimes(1)
  })

  it("is bounded: gives up after exactly 3 attempts and never retries indefinitely", async () => {
    const session = fakeSession()
    vi.spyOn(mongoose, "startSession").mockResolvedValue(session as any)
    vi.mocked(SettlementRecord.create).mockRejectedValue(duplicateKeyError("settlementId"))

    await expect(initiateSettlement(baseInput)).rejects.toThrow(/unique settlement id after 3 attempts/i)
    expect(SettlementRecord.create).toHaveBeenCalledTimes(3)
    expect(session.endSession).toHaveBeenCalledTimes(1)
  })

  it("logs each collision retry for observability", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
    const session = fakeSession()
    vi.spyOn(mongoose, "startSession").mockResolvedValue(session as any)

    vi.mocked(SettlementRecord.create)
      .mockRejectedValueOnce(duplicateKeyError("settlementId"))
      .mockResolvedValueOnce([{ settlementId: "STL-v1-x-ok" }] as any)

    await initiateSettlement(baseInput)

    expect(warnSpy).toHaveBeenCalledWith(
      "SETTLEMENT_ID_COLLISION_RETRY",
      expect.objectContaining({ attempt: 1, rail: "paystack" }),
    )
    warnSpy.mockRestore()
  })

  it("still treats a providerReference collision as an idempotent replay, not a settlementId retry", async () => {
    const session = fakeSession()
    vi.spyOn(mongoose, "startSession").mockResolvedValue(session as any)

    const existingSettlement = { settlementId: "STL-v1-existing", providerReference: baseInput.providerReference }
    vi.mocked(SettlementRecord.create).mockRejectedValueOnce(
      duplicateKeyError("providerReference"),
    )
    vi.mocked(SettlementRecord.findOne)
      .mockResolvedValueOnce(null as any) // pre-check at function start: no existing record yet
      .mockResolvedValueOnce(existingSettlement as any) // post-collision idempotent-replay lookup

    const result = await initiateSettlement(baseInput)

    expect(result.alreadyExists).toBe(true)
    expect(result.settlement).toEqual(existingSettlement)
    // No retry loop for a providerReference collision — exactly one create() attempt.
    expect(SettlementRecord.create).toHaveBeenCalledTimes(1)
  })
})
