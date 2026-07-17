import { describe, expect, it } from "vitest"

import { ApiErrorSchema, PaymentInitializeRequestSchema, PoolInvestmentResponseSchema } from "@/lib/api/contracts"

describe("API contracts", () => {
  it("rejects client supplied exchange rates on payment initialization", () => {
    const result = PaymentInitializeRequestSchema.safeParse({
      amountNgn: 1000,
      exchangeRate: 1500,
    })

    expect(result.success).toBe(false)
  })

  it("validates standardized errors", () => {
    expect(ApiErrorSchema.parse({ message: "Unauthorized", code: "AUTH_REQUIRED" }).code).toBe("AUTH_REQUIRED")
  })

  it("prevents private field leakage in pool investment responses", () => {
    const result = PoolInvestmentResponseSchema.safeParse({
      success: true,
      investment: {
        poolId: "pool",
        userId: "user",
        amountNgn: 1000,
        ownershipUnits: 10,
        ownershipBps: 1,
        txRef: "tx",
        poolStatus: "OPEN",
        currentRaisedNgn: 1000,
        targetAmountNgn: 100000,
        investorCount: 1,
        userBalanceNgn: 5000,
        passwordHash: "should-not-pass",
      },
    })

    expect(result.success).toBe(true)
    if (result.success) {
      expect("passwordHash" in result.data.investment).toBe(false)
    }
  })
})
