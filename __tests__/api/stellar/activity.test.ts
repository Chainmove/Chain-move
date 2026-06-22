import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireAuthenticatedUser, finalizeAuthenticatedResponse, getStellarConfig, find, loadAccount } = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  finalizeAuthenticatedResponse: vi.fn(async (response: unknown) => response),
  getStellarConfig: vi.fn(),
  find: vi.fn(),
  loadAccount: vi.fn(),
}))

vi.mock("@/lib/api/route-guard", () => ({ requireAuthenticatedUser, finalizeAuthenticatedResponse }))
vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/lib/stellar/config", () => ({ getStellarConfig }))
vi.mock("@/lib/stellar/client", () => ({
  getStellarClient: vi.fn(() => ({
    horizon: {
      loadAccount,
    },
  })),
}))

vi.mock("@/models/StellarIndexedEvent", () => ({
  default: {
    find,
  },
}))

import { GET } from "@/app/api/stellar/activity/route"

function buildRequest() {
  return new Request("http://localhost/api/stellar/activity", {
    method: "GET",
  })
}

function buildUser(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    _id: "user-1",
    name: "Test User",
    email: "test@example.com",
    role: "investor",
    stellarPublicKey: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    ...overrides,
  }
}

describe("GET /api/stellar/activity", () => {
  beforeEach(() => {
    requireAuthenticatedUser.mockReset()
    finalizeAuthenticatedResponse.mockClear()
    getStellarConfig.mockReset()
    find.mockReset()
    loadAccount.mockReset()
  })

  it("returns 401/error if not authenticated", async () => {
    requireAuthenticatedUser.mockResolvedValue({
      response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }),
    })

    const response = await GET(buildRequest())
    expect(response.status).toBe(401)
  })

  it("returns mock data when mock mode is enabled", async () => {
    const user = buildUser()
    requireAuthenticatedUser.mockResolvedValue({ user })
    getStellarConfig.mockReturnValue({
      mock: true,
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      contractId: "C123",
      issuerPublicKey: "GD123",
    })

    const response = await GET(buildRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.mock).toBe(true)
    expect(payload.balances.length).toBeGreaterThan(0)
    expect(payload.activities.length).toBeGreaterThan(0)
    expect(loadAccount).not.toHaveBeenCalled()
  })

  it("returns empty balances/activities if live mode but no public key is linked", async () => {
    const user = buildUser({ stellarPublicKey: null })
    requireAuthenticatedUser.mockResolvedValue({ user })
    getStellarConfig.mockReturnValue({
      mock: false,
      network: "testnet",
    })

    const response = await GET(buildRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload.balances).toEqual([])
    expect(payload.activities).toEqual([])
  })

  it("fetches live balances and database events when live mode and key is linked", async () => {
    const user = buildUser()
    requireAuthenticatedUser.mockResolvedValue({ user })
    getStellarConfig.mockReturnValue({
      mock: false,
      network: "testnet",
    })

    loadAccount.mockResolvedValue({
      balances: [
        { asset_type: "native", balance: "150.00" },
        { asset_type: "credit_alphanum4", asset_code: "USDC", balance: "20.00", asset_issuer: "GDUSDC" },
      ],
    })

    find.mockReturnValue({
      sort: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          lean: vi.fn().mockResolvedValue([
            {
              _id: "tx-1",
              chainMoveRecordType: "repayment",
              eventType: "payment",
              amount: "100.00",
              asset: "CMOVE",
              sourceAccount: user.stellarPublicKey,
              destinationAccount: "GBX",
              createdAt: new Date(),
              raw: { transaction_hash: "hash-1" },
            },
          ]),
        }),
      }),
    })

    const response = await GET(buildRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(loadAccount).toHaveBeenCalledWith(user.stellarPublicKey)
    expect(payload.balances).toEqual([
      { asset: "XLM", balance: "150.00", type: "native", issuer: null },
      { asset: "USDC", balance: "20.00", type: "credit_alphanum4", issuer: "GDUSDC" },
    ])
    expect(payload.activities[0].id).toBe("tx-1")
    expect(payload.activities[0].title).toBe("Repayment Settlement")
  })
})
