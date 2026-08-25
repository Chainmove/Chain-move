import { beforeEach, describe, expect, it, vi } from "vitest"

const { findById, getSessionFromCookies, extractPrivyTokenFromRequest } = vi.hoisted(() => ({
  findById: vi.fn(),
  getSessionFromCookies: vi.fn(),
  extractPrivyTokenFromRequest: vi.fn(() => null),
}))

vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/models/User", () => ({ default: { findById, findOne: vi.fn() } }))
vi.mock("@/lib/auth/session", () => ({
  getSessionFromCookies,
  setSessionCookie: vi.fn(),
  signSessionToken: vi.fn(async () => "token"),
}))
vi.mock("@/lib/auth/privy", () => ({
  extractPrivyTokenFromRequest,
  getPrivyProfileFromPayload: vi.fn(),
  verifyPrivyToken: vi.fn(),
}))

import { GET } from "@/app/api/auth/me/route"

const USER_ID = "507f1f77bcf86cd799439011"

let selectArgument = ""

function seedUser(overrides: Record<string, unknown> = {}) {
  const user = {
    _id: { toString: () => USER_ID },
    name: "Driver",
    fullName: "Driver One",
    email: "driver@example.com",
    role: "driver",
    kycStatus: "approved",
    isKycVerified: true,
    ...overrides,
  }

  findById.mockImplementation(() => ({
    select: (fields: string) => {
      selectArgument = fields
      return Promise.resolve(user)
    },
  }))

  return user
}

describe("GET /api/auth/me", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    selectArgument = ""
    getSessionFromCookies.mockResolvedValue({ userId: USER_ID })
  })

  it("does not project the deprecated embedded notifications array", async () => {
    seedUser()

    await GET(new Request("http://localhost/api/auth/me"))

    expect(selectArgument).not.toContain("notifications")
  })

  it("omits notifications from the auth payload entirely", async () => {
    seedUser()

    const response = await GET(new Request("http://localhost/api/auth/me"))
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(payload).toMatchObject({ id: USER_ID, role: "driver" })
    expect(payload).not.toHaveProperty("notifications")
  })

  it("never leaks a stale embedded array even when the document still carries one", async () => {
    // A user who has not yet been migrated still has the legacy field on disk.
    seedUser({ notifications: [{ id: "legacy", title: "Old", message: "Old", read: false }] })

    const payload = await (await GET(new Request("http://localhost/api/auth/me"))).json()

    expect(payload).not.toHaveProperty("notifications")
  })
})
