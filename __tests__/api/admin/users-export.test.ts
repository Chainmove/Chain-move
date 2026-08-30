import { beforeEach, describe, expect, it, vi } from "vitest"

const { authorizeRequest, find } = vi.hoisted(() => ({
  authorizeRequest: vi.fn(),
  find: vi.fn(),
}))

vi.mock("@/lib/authorization/route", () => ({ authorizeRequest }))
vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/models/User", () => ({ default: { find } }))

import { GET } from "@/app/api/admin/users/export/route"

function buildRequest() {
  return new Request("http://localhost/api/admin/users/export", { method: "GET" })
}

function fakeQuery(docs: unknown[]) {
  const query: any = {
    select: () => query,
    sort: () => query,
    lean: () => Promise.resolve(docs),
  }
  return query
}

describe("GET /api/admin/users/export", () => {
  beforeEach(() => {
    authorizeRequest.mockReset()
    find.mockReset()
  })

  it("returns the auth response when unauthorized", async () => {
    const response = { status: 403 }
    authorizeRequest.mockResolvedValue({ response })
    const result = await GET(buildRequest())
    expect(result).toBe(response)
    expect(find).not.toHaveBeenCalled()
  })

  it("neutralizes a formula-injection payload in an admin-facing field", async () => {
    authorizeRequest.mockResolvedValue({ user: { _id: "u1" }, shouldRefreshSession: false })
    find.mockReturnValue(
      fakeQuery([
        {
          fullName: "=HYPERLINK(\"http://evil.example\",\"click\")",
          email: "attacker@example.com",
          role: "driver",
          privyUserId: "privy-1",
          createdAt: new Date("2026-01-01T00:00:00.000Z"),
        },
      ]),
    )

    const response = (await GET(buildRequest()))!
    const body = await response.text()
    const lines = body.trim().split("\n")

    expect(lines[0]).toBe("Name,Email,Role,Privy User ID,Created At")
    expect(lines[1]).toBe(
      `"'=HYPERLINK(""http://evil.example"",""click"")",attacker@example.com,driver,privy-1,2026-01-01T00:00:00.000Z`,
    )
  })

  it("leaves an ordinary user record untouched", async () => {
    authorizeRequest.mockResolvedValue({ user: { _id: "u1" }, shouldRefreshSession: false })
    find.mockReturnValue(
      fakeQuery([
        {
          fullName: "Ada Lovelace",
          email: "ada@example.com",
          role: "investor",
          privyUserId: "privy-2",
          createdAt: new Date("2026-02-02T00:00:00.000Z"),
        },
      ]),
    )

    const response = (await GET(buildRequest()))!
    const body = await response.text()
    expect(body).toContain("Ada Lovelace,ada@example.com,investor,privy-2,2026-02-02T00:00:00.000Z")
  })
})
