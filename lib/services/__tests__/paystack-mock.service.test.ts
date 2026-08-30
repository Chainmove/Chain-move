import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  createMockDriverDvaDetails,
  createMockDvaRepaymentReference,
  isMockPaymentsEnabled,
  isMockPaymentsRuntimeAllowed,
  isMockVirtualAccountRecord,
  MOCK_PAYSTACK_ACCOUNT_NAME,
  MOCK_PAYSTACK_BANK_NAME,
  MOCK_PAYSTACK_PROVIDER,
} from "../paystack-mock.service"

describe("paystack-mock.service", () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })

  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it("enables mock payments only when ENABLE_MOCK_PAYMENTS is true", () => {
    expect(isMockPaymentsEnabled()).toBe(false)

    vi.stubEnv("ENABLE_MOCK_PAYMENTS", "true")
    expect(isMockPaymentsEnabled()).toBe(true)
  })

  it("blocks mock runtime actions in production", () => {
    vi.stubEnv("ENABLE_MOCK_PAYMENTS", "true")
    vi.stubEnv("NODE_ENV", "production")
    expect(isMockPaymentsRuntimeAllowed()).toBe(false)

    vi.stubEnv("NODE_ENV", "development")
    expect(isMockPaymentsRuntimeAllowed()).toBe(true)
  })

  it("returns visibly fake deterministic mock DVA details", () => {
    const first = createMockDriverDvaDetails({
      driverUserId: "64b1f2a3c4d5e6f7a8b9c0d1",
      contractId: "74c1f2a3c4d5e6f7a8b9c0d2",
    })
    const second = createMockDriverDvaDetails({
      driverUserId: "64b1f2a3c4d5e6f7a8b9c0d1",
      contractId: "74c1f2a3c4d5e6f7a8b9c0d2",
    })
    const other = createMockDriverDvaDetails({
      driverUserId: "84c1f2a3c4d5e6f7a8b9c0d3",
      contractId: "74c1f2a3c4d5e6f7a8b9c0d2",
    })

    expect(first.provider).toBe(MOCK_PAYSTACK_PROVIDER)
    expect(first.bankName).toBe(MOCK_PAYSTACK_BANK_NAME)
    expect(first.accountName).toContain(MOCK_PAYSTACK_ACCOUNT_NAME)
    expect(first.accountNumber).toMatch(/^0000[0-9a-f]{6}$/)
    expect(first.mock).toBe(true)
    expect(first.testOnly).toBe(true)
    expect(first.accountNumber).toBe(second.accountNumber)
    expect(first.accountNumber).not.toBe(other.accountNumber)
    expect(first.reference).toMatch(/^mock_dva_\d+$/)
  })

  it("creates mock repayment references with the expected prefix", () => {
    expect(createMockDvaRepaymentReference()).toMatch(/^mock_dva_repay_\d+$/)
  })

  it("detects mock virtual account records from raw response metadata", () => {
    expect(isMockVirtualAccountRecord({ mock: true })).toBe(true)
    expect(isMockVirtualAccountRecord({ provider: MOCK_PAYSTACK_PROVIDER })).toBe(true)
    expect(isMockVirtualAccountRecord({ provider: "PAYSTACK" })).toBe(false)
    expect(isMockVirtualAccountRecord(null)).toBe(false)
  })
})
