import { beforeEach, describe, expect, it, vi } from "vitest"

const { authorizeRequest, find } = vi.hoisted(() => ({
  authorizeRequest: vi.fn(),
  find: vi.fn(),
}))

vi.mock("@/lib/authorization/route", () => ({ authorizeRequest }))
vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/models/User", () => ({ default: { find } }))

import { GET } from "@/app/api/admin/reports/export/route"

function buildRequest(query: string) {
  return new Request(`http://localhost/api/admin/reports/export?${query}`, { method: "GET" })
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
    select: () => query,
    sort: () => query,
    lean: () => query,
    cursor: () => fakeCursor(docs),
  }
  return query
}

describe("GET /api/admin/reports/export", () => {
  beforeEach(() => {
    authorizeRequest.mockReset()
    find.mockReset()
  })

  it("returns the auth response when unauthorized", async () => {
    const response = { status: 403 }
    authorizeRequest.mockResolvedValue({ response })
    const result = await GET(buildRequest("type=users"))
    expect(result).toBe(response)
  })

  it("neutralizes a formula-injection payload in the users report", async () => {
    authorizeRequest.mockResolvedValue({ user: { _id: "u1" }, shouldRefreshSession: false })
    find.mockReturnValue(
      fakeQuery([
        {
          fullName: "-2+3+cmd|' /C calc'!A0",
          email: "attacker@example.com",
          role: "driver",
          kycVerified: false,
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    )

    const response = (await GET(buildRequest("type=users&range=all")))!
    const body = await response.text()
    const lines = body.replace(/^\uFEFF/, "").trim().split("\n")

    expect(lines[0]).toBe("Date Joined,Name,Email,Role,KYC Verified")
    expect(lines[1]).toBe(`2026-01-01T00:00:00.000Z,'-2+3+cmd|' /C calc'!A0,attacker@example.com,driver,No`)
  })

  it("rejects an unknown export type", async () => {
    authorizeRequest.mockResolvedValue({ user: { _id: "u1" }, shouldRefreshSession: false })
    const response = (await GET(buildRequest("type=not-a-real-type")))!
    expect(response.status).toBe(400)
  })
})
