import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireAuthenticatedUser, aggregate, find } = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  aggregate: vi.fn(),
  find: vi.fn(),
}))

vi.mock("@/lib/api/route-guard", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/route-guard")>()
  return { ...actual, requireAuthenticatedUser }
})
vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/models/Transaction", () => ({ default: { aggregate, find } }))
vi.mock("@/models/User", () => ({ default: {} }))

import { GET } from "@/app/api/transactions/ledger/export/route"

function buildRequest() {
  return new Request("http://localhost/api/transactions/ledger/export", { method: "GET" })
}

function fakeCursor(docs: unknown[]) {
  return {
    [Symbol.asyncIterator]: async function* () {
      for (const doc of docs) yield doc
    },
  }
}

function fakeQuery(docs: unknown[]) {
  const query: any = {
    sort: () => query,
    populate: () => query,
    lean: () => query,
    cursor: () => fakeCursor(docs),
  }
  return query
}

describe("GET /api/transactions/ledger/export", () => {
  beforeEach(() => {
    requireAuthenticatedUser.mockReset()
    aggregate.mockReset()
    find.mockReset()
    aggregate.mockResolvedValue([])
  })

  it("returns the auth response when unauthorized", async () => {
    const response = { status: 401 }
    requireAuthenticatedUser.mockResolvedValue({ response })
    const result = await GET(buildRequest())
    expect(result).toBe(response)
  })

  it("neutralizes a formula-injection payload in the transaction description", async () => {
    requireAuthenticatedUser.mockResolvedValue({
      user: { _id: { toString: () => "admin-1" }, role: "admin" },
    })
    find.mockReturnValue(
      fakeQuery([
        {
          _id: "tx-1",
          userId: { _id: "user-1", fullName: "Ada Lovelace", email: "ada@example.com" },
          userType: "driver",
          type: "repayment",
          amount: 5000,
          currency: "NGN",
          status: "Completed",
          gatewayReference: "ref-1",
          description: "@SUM(1,2)+cmd",
          timestamp: new Date("2026-03-01T00:00:00.000Z"),
        },
      ]),
    )

    const response = (await GET(buildRequest()))!
    const body = await response.text()
    const lines = body.replace(/^\uFEFF/, "").trim().split("\n")

    expect(lines[0].split(",")).toContain("Description")
    expect(lines[1]).toContain(`"'@SUM(1,2)+cmd"`)
  })

  it("preserves an ordinary numeric amount without alteration", async () => {
    requireAuthenticatedUser.mockResolvedValue({
      user: { _id: { toString: () => "admin-1" }, role: "admin" },
    })
    find.mockReturnValue(
      fakeQuery([
        {
          _id: "tx-2",
          userId: { _id: "user-2", fullName: "Chinwe Okoro", email: "chinwe@example.com" },
          userType: "investor",
          type: "deposit",
          amount: -1500,
          currency: "NGN",
          status: "Completed",
          gatewayReference: "ref-2",
          description: "Wallet top-up",
          timestamp: new Date("2026-03-02T00:00:00.000Z"),
        },
      ]),
    )

    const response = (await GET(buildRequest()))!
    const body = await response.text()
    expect(body).toContain(",-1500,NGN,")
  })
})
