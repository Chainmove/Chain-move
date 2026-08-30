import type { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { getAuthenticatedUser, withSessionRefresh, findOne } = vi.hoisted(() => ({
  getAuthenticatedUser: vi.fn(),
  withSessionRefresh: vi.fn(async (response: unknown) => response),
  findOne: vi.fn(),
}))

vi.mock("@/lib/auth/current-user", () => ({ getAuthenticatedUser, withSessionRefresh }))
vi.mock("@/models/User", () => ({ default: { findOne } }))

import { POST } from "./route"

async function callRoute(body: unknown): Promise<NextResponse> {
  return (await POST(buildRequest(body))) as NextResponse
}

// Real Stellar public accounts (StrKey, version byte + CRC16 checksum).
const VALID_KEY = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"
const OTHER_VALID_KEY = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H"

function buildRequest(body: unknown) {
  return new Request("http://localhost/api/auth/stellar/link", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

function buildUser(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    _id: { toString: () => "user-1" },
    name: "Test User",
    fullName: "Test User",
    email: "test@example.com",
    role: "investor",
    password: "should-never-be-returned",
    save: vi.fn().mockResolvedValue(undefined),
    ...overrides,
  }
}

function selectResolving(value: unknown) {
  return { select: vi.fn().mockResolvedValue(value) }
}

beforeEach(() => {
  getAuthenticatedUser.mockReset()
  withSessionRefresh.mockClear()
  findOne.mockReset()
})

describe("POST /api/auth/stellar/link", () => {
  it("rejects unauthenticated requests with 401", async () => {
    getAuthenticatedUser.mockResolvedValue({ user: null, shouldRefreshSession: false })

    const response = await callRoute({ stellarPublicKey: VALID_KEY })

    expect(response.status).toBe(401)
    expect(findOne).not.toHaveBeenCalled()
  })

  it("rejects a missing public account value with 400", async () => {
    getAuthenticatedUser.mockResolvedValue({ user: buildUser(), shouldRefreshSession: false })

    const response = await callRoute({})

    expect(response.status).toBe(400)
  })

  it("rejects an invalid public account value with 400", async () => {
    getAuthenticatedUser.mockResolvedValue({ user: buildUser(), shouldRefreshSession: false })

    const response = await callRoute({ stellarPublicKey: "not-a-valid-stellar-key" })

    expect(response.status).toBe(400)
    expect(findOne).not.toHaveBeenCalled()
  })

  it("rejects a duplicate account owned by another user with 409", async () => {
    getAuthenticatedUser.mockResolvedValue({ user: buildUser(), shouldRefreshSession: false })
    findOne.mockReturnValue(selectResolving({ _id: { toString: () => "another-user" } }))

    const response = await callRoute({ stellarPublicKey: VALID_KEY })

    expect(response.status).toBe(409)
  })

  it("links a valid account and returns only safe profile fields", async () => {
    const user = buildUser()
    getAuthenticatedUser.mockResolvedValue({ user, shouldRefreshSession: false })
    findOne.mockReturnValue(selectResolving(null))

    const response = await callRoute({ stellarPublicKey: `  ${VALID_KEY}  ` })
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(user.stellarPublicKey).toBe(VALID_KEY)
    expect(user.save).toHaveBeenCalledTimes(1)
    expect(payload.user.stellarPublicKey).toBe(VALID_KEY)
    expect(payload.user.id).toBe("user-1")
    // Only the safe snapshot is returned — secrets must never leak.
    expect(payload.user.password).toBeUndefined()
    expect(Object.prototype.hasOwnProperty.call(payload.user, "save")).toBe(false)
  })

  it("sets stellarLinkedAt on the first link", async () => {
    const user = buildUser()
    getAuthenticatedUser.mockResolvedValue({ user, shouldRefreshSession: false })
    findOne.mockReturnValue(selectResolving(null))

    const before = Date.now()
    await callRoute({ stellarPublicKey: VALID_KEY })
    const after = Date.now()

    expect(user.stellarLinkedAt).toBeInstanceOf(Date)
    expect((user.stellarLinkedAt as Date).getTime()).toBeGreaterThanOrEqual(before)
    expect((user.stellarLinkedAt as Date).getTime()).toBeLessThanOrEqual(after)
  })

  it("does not overwrite stellarLinkedAt when re-linking", async () => {
    const existingLinkedAt = new Date("2024-01-01")
    const user = buildUser({ stellarPublicKey: VALID_KEY, stellarLinkedAt: existingLinkedAt })
    getAuthenticatedUser.mockResolvedValue({ user, shouldRefreshSession: false })
    findOne.mockReturnValue(selectResolving({ _id: { toString: () => "user-1" } }))

    await callRoute({ stellarPublicKey: OTHER_VALID_KEY })

    expect(user.stellarLinkedAt).toBe(existingLinkedAt)
  })

  it("allows the same user to re-link their own account", async () => {
    const user = buildUser()
    getAuthenticatedUser.mockResolvedValue({ user, shouldRefreshSession: false })
    findOne.mockReturnValue(selectResolving({ _id: { toString: () => "user-1" } }))

    const response = await callRoute({ stellarPublicKey: OTHER_VALID_KEY })

    expect(response.status).toBe(200)
    expect(user.save).toHaveBeenCalledTimes(1)
  })

  it("returns 409 when the unique index rejects a concurrent duplicate", async () => {
    const user = buildUser({
      save: vi.fn().mockRejectedValue(Object.assign(new Error("E11000"), { code: 11000 })),
    })
    getAuthenticatedUser.mockResolvedValue({ user, shouldRefreshSession: false })
    findOne.mockReturnValue(selectResolving(null))

    const response = await callRoute({ stellarPublicKey: VALID_KEY })

    expect(response.status).toBe(409)
  })
})
