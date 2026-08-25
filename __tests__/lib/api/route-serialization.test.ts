// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"

import type { NextRouteContext } from "@/lib/api/route-handler"

/**
 * End-to-end serialization tests for the converted routes.
 *
 * These invoke the real route handlers with mocked database results, so they
 * exercise the actual field mapping, money conversion, and response-schema
 * validation. That is what catches a mistyped field name between a Mongoose
 * document and the published contract.
 *
 * Each case also asserts the exact paths the dashboards read, so a rename that
 * would blank out a number in the UI fails here instead of in production.
 */

const getAuthenticatedUser = vi.fn()

vi.mock("@/lib/auth/current-user", () => ({
  getAuthenticatedUser: (request: Request) => getAuthenticatedUser(request),
  withSessionRefresh: async (response: unknown) => response,
}))

vi.mock("@/lib/authorization/audit", () => ({ logAuthorizationDenial: async () => undefined }))
vi.mock("@/lib/dbConnect", () => ({ default: async () => undefined }))

const transactionFind = vi.fn()
const transactionAggregate = vi.fn()
const transactionCount = vi.fn()

vi.mock("@/models/Transaction", () => ({
  default: {
    find: (...args: unknown[]) => transactionFind(...args),
    aggregate: (...args: unknown[]) => transactionAggregate(...args),
    countDocuments: (...args: unknown[]) => transactionCount(...args),
  },
}))

const investmentFind = vi.fn()
vi.mock("@/models/Investment", () => ({ default: { find: (...a: unknown[]) => investmentFind(...a) } }))

const userFind = vi.fn()
const userCount = vi.fn()
vi.mock("@/models/User", () => ({
  default: {
    find: (...a: unknown[]) => userFind(...a),
    countDocuments: (...a: unknown[]) => userCount(...a),
  },
}))

const listPools = vi.fn()
vi.mock("@/lib/services/pools.service", () => ({
  listPools: (...a: unknown[]) => listPools(...a),
  createPool: vi.fn(),
}))

/** Mongoose query builders are chainable; every step returns `this`. */
function chainable(result: unknown) {
  const chain: Record<string, unknown> = {}
  for (const method of ["sort", "limit", "skip", "select", "populate"]) {
    chain[method] = () => chain
  }
  chain.lean = async () => result
  chain.then = (resolve: (value: unknown) => unknown) => Promise.resolve(result).then(resolve)
  return chain
}

/**
 * Next.js always passes a route context; routes without dynamic segments
 * simply receive empty params. Tests mirror that call shape.
 */
const noParams: NextRouteContext = { params: Promise.resolve({}) }

const INVESTOR_ID = "665f1a2b3c4d5e6f70819203"

function authenticateAs(role: string, overrides: Record<string, unknown> = {}) {
  getAuthenticatedUser.mockResolvedValue({
    user: {
      _id: INVESTOR_ID,
      role,
      availableBalance: 45000,
      walletAddress: null,
      kycStatus: "approved_stage2",
      ...overrides,
    },
    shouldRefreshSession: false,
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  authenticateAs("investor")
})

describe("GET /api/wallet/summary", () => {
  it("serializes the balance and transactions the wallet panel reads", async () => {
    transactionFind.mockReturnValue(
      chainable([
        {
          _id: "665f1a2b3c4d5e6f70819210",
          type: "wallet_funding",
          amount: 25000,
          currency: "NGN",
          status: "Completed",
          method: "paystack",
          description: "Wallet funding",
          gatewayReference: "cm_wallet_1",
          timestamp: new Date("2026-01-30T09:15:00Z"),
        },
      ]),
    )

    const { GET } = await import("@/app/api/wallet/summary/route")
    const response = await GET(new Request("https://chainmove.test/api/wallet/summary"), noParams)
    const body = await response.json()

    expect(response.status).toBe(200)

    // Paths read by components/dashboard/investor-wallet-panel.tsx
    expect(body.wallet.internalBalance.amountMajor).toBe(45000)
    expect(body.wallet.internalBalance.amountMinor).toBe(4500000)
    expect(body.wallet.walletAddress).toBeNull()
    expect(body.transactions[0].amount.amountMajor).toBe(25000)
    expect(body.transactions[0].timestamp).toBe("2026-01-30T09:15:00.000Z")
  })

  it("does not leak undeclared transaction fields", async () => {
    transactionFind.mockReturnValue(
      chainable([
        {
          _id: "665f1a2b3c4d5e6f70819210",
          type: "deposit",
          amount: 100,
          status: "Completed",
          description: "",
          timestamp: new Date(),
          __v: 4,
          metadata: { ip_address: "10.0.0.5", authorization: { last4: "4081" } },
          bookedQuoteSnapshot: { rate: 1500 },
        },
      ]),
    )

    const { GET } = await import("@/app/api/wallet/summary/route")
    const body = await (await GET(new Request("https://chainmove.test/api/wallet/summary"), noParams)).json()

    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain("10.0.0.5")
    expect(serialized).not.toContain("4081")
    expect(serialized).not.toContain("bookedQuoteSnapshot")
    expect(serialized).not.toContain("__v")
  })
})

describe("GET /api/investments", () => {
  it("serializes the fields the portfolio page reads", async () => {
    investmentFind.mockReturnValue(
      chainable([
        {
          _id: "665f1a2b3c4d5e6f70819211",
          investorId: INVESTOR_ID,
          loanId: "loan-1",
          vehicleId: "665f1a2b3c4d5e6f70819212",
          amount: 250000,
          monthlyReturn: 12500,
          status: "Active",
          date: new Date("2026-01-05T00:00:00Z"),
          __v: 0,
        },
      ]),
    )

    const { GET } = await import("@/app/api/investments/route")
    const response = await GET(new Request("https://chainmove.test/api/investments"), noParams)
    const body = await response.json()

    expect(response.status).toBe(200)

    // Paths read by app/dashboard/investor/investments/page.tsx
    const investment = body.investments[0]
    expect(investment.id).toBe("665f1a2b3c4d5e6f70819211")
    expect(investment.amount.amountMajor).toBe(250000)
    expect(investment.monthlyReturn.amountMajor).toBe(12500)
    expect(investment.date).toBe("2026-01-05T00:00:00.000Z")
    expect(investment.status).toBe("Active")
    expect(JSON.stringify(body)).not.toContain("__v")
  })
})

describe("GET /api/pools", () => {
  it("converts every NGN field the opportunities page renders", async () => {
    listPools.mockResolvedValue([
      {
        id: "665f1a2b3c4d5e6f70819213",
        assetType: "KEKE",
        assetPriceNgn: 2500000,
        targetAmountNgn: 2500000,
        minContributionNgn: 50000,
        status: "OPEN",
        currentRaisedNgn: 1000000,
        remainingAmountNgn: 1500000,
        investorCount: 3,
        progressRatio: 0.4,
        description: "Lagos tricycle pool",
        createdBy: "665f1a2b3c4d5e6f70819214",
        createdAt: new Date("2026-01-01T00:00:00Z"),
        updatedAt: new Date("2026-01-20T00:00:00Z"),
        userOwnershipUnits: 20,
        userOwnershipBps: 200,
        userInvestedNgn: 50000,
      },
    ])

    const { GET } = await import("@/app/api/pools/route")
    const response = await GET(new Request("https://chainmove.test/api/pools"), noParams)
    const body = await response.json()

    expect(response.status).toBe(200)

    // Paths read by app/dashboard/investor/opportunities/page.tsx
    const pool = body.pools[0]
    expect(pool.assetPrice.amountMajor).toBe(2500000)
    expect(pool.targetAmount.amountMajor).toBe(2500000)
    expect(pool.minContribution.amountMajor).toBe(50000)
    expect(pool.currentRaised.amountMajor).toBe(1000000)
    expect(pool.remainingAmount.amountMajor).toBe(1500000)
    expect(pool.userInvested.amountMajor).toBe(50000)
    expect(pool.investorCount).toBe(3)
  })

  it("omits per-user ownership when the pool was not loaded for a caller", async () => {
    listPools.mockResolvedValue([
      {
        id: "665f1a2b3c4d5e6f70819213",
        assetType: "SHUTTLE",
        assetPriceNgn: 100,
        targetAmountNgn: 100,
        minContributionNgn: 10,
        status: "OPEN",
        currentRaisedNgn: 0,
        remainingAmountNgn: 100,
        investorCount: 0,
        progressRatio: 0,
        description: null,
        createdBy: "665f1a2b3c4d5e6f70819214",
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    ])

    const { GET } = await import("@/app/api/pools/route")
    const body = await (await GET(new Request("https://chainmove.test/api/pools"), noParams)).json()

    // The page renders `userInvested?.amountMajor || 0`, so absent is safe.
    expect(body.pools[0].userInvested).toBeUndefined()
    expect(body.pools[0].description).toBeNull()
  })
})

describe("GET /api/transactions/ledger", () => {
  beforeEach(() => {
    transactionAggregate.mockImplementation(async (pipeline: Array<Record<string, unknown>>) => {
      const isDuplicateScan = JSON.stringify(pipeline).includes("gatewayReference")
      return isDuplicateScan ? [] : [{ _id: "Completed", count: 1, amount: 25000 }]
    })
    transactionCount.mockResolvedValue(1)
    transactionFind.mockReturnValue(
      chainable([
        {
          _id: "665f1a2b3c4d5e6f70819215",
          userId: INVESTOR_ID,
          userType: "investor",
          type: "wallet_funding",
          amount: 25000,
          currency: "NGN",
          status: "Completed",
          method: "paystack",
          gatewayReference: "cm_wallet_1",
          description: "Wallet funding",
          timestamp: new Date("2026-01-30T09:15:00Z"),
          metadata: { ip_address: "10.0.0.5", authorization: { last4: "4081" } },
        },
      ]),
    )
  })

  it("serializes entries, pagination, and summary the ledger table reads", async () => {
    const { GET } = await import("@/app/api/transactions/ledger/route")
    const response = await GET(new Request("https://chainmove.test/api/transactions/ledger?page=1&pageSize=20"), noParams)
    const body = await response.json()

    expect(response.status).toBe(200)

    // Paths read by components/dashboard/ledger/transaction-ledger.tsx
    expect(body.scope).toBe("self")
    expect(body.transactions[0].amount.amountMajor).toBe(25000)
    expect(body.transactions[0].originalAmount).toBeNull()
    expect(body.pagination).toMatchObject({ page: 1, pageSize: 20, total: 1, totalPages: 1 })
    expect(body.summary.totalAmount.amountMajor).toBe(25000)
    expect(body.summary.completedAmount.amountMajor).toBe(25000)
    expect(body.summary.completedCount).toBe(1)
  })

  it("drops raw provider metadata", async () => {
    const { GET } = await import("@/app/api/transactions/ledger/route")
    const body = await (await GET(new Request("https://chainmove.test/api/transactions/ledger"), noParams)).json()

    expect(body.transactions[0].metadata).toBeUndefined()
    expect(JSON.stringify(body)).not.toContain("10.0.0.5")
    expect(JSON.stringify(body)).not.toContain("4081")
  })

  it("reports global scope for admins", async () => {
    authenticateAs("admin")

    const { GET } = await import("@/app/api/transactions/ledger/route")
    const body = await (await GET(new Request("https://chainmove.test/api/transactions/ledger"), noParams)).json()

    expect(body.scope).toBe("global")
  })
})

describe("GET /api/admin/kyc-requests", () => {
  it("serializes the review queue the admin page reads", async () => {
    authenticateAs("admin")
    userFind.mockReturnValue(
      chainable([
        {
          _id: "665f1a2b3c4d5e6f70819216",
          role: "driver",
          name: "A Driver",
          fullName: "A Full Driver",
          email: "driver@example.test",
          phoneNumber: "+2348000000000",
          kycStatus: "pending",
          kycDocuments: ["kycdoc_v1_abc", "kycdoc_v1_def"],
          kycRejectionReason: null,
          physicalMeetingStatus: "scheduled",
          physicalMeetingDate: new Date("2026-02-10T00:00:00Z"),
          updatedAt: new Date("2026-01-30T09:15:00Z"),
          password: "$2b$10$leaked",
        },
      ]),
    )
    userCount.mockResolvedValue(1)

    const { GET } = await import("@/app/api/admin/kyc-requests/route")
    const response = await GET(new Request("https://chainmove.test/api/admin/kyc-requests"), noParams)
    const body = await response.json()

    expect(response.status).toBe(200)

    // Paths read by app/dashboard/admin/kyc-management/page.tsx
    const request = body.requests[0]
    expect(request.id).toBe("665f1a2b3c4d5e6f70819216")
    expect(request.name).toBe("A Full Driver")
    expect(request.documentReferences).toEqual(["kycdoc_v1_abc", "kycdoc_v1_def"])
    expect(request.documentCount).toBe(2)
    expect(request.physicalMeetingStatus).toBe("scheduled")
    expect(request.physicalMeetingDate).toBe("2026-02-10T00:00:00.000Z")
    expect(body.pagination.total).toBe(1)

    expect(JSON.stringify(body)).not.toContain("leaked")
  })

  it("refuses a non-admin caller", async () => {
    authenticateAs("investor")

    const { GET } = await import("@/app/api/admin/kyc-requests/route")
    const response = await GET(new Request("https://chainmove.test/api/admin/kyc-requests"), noParams)

    expect(response.status).toBe(403)
  })
})
