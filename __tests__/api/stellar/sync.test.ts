import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireAuthenticatedUser, finalizeAuthenticatedResponse, sync } = vi.hoisted(() => ({
  requireAuthenticatedUser: vi.fn(),
  finalizeAuthenticatedResponse: vi.fn(async (response: unknown) => response),
  sync: vi.fn(),
}))

vi.mock("@/lib/api/route-guard", () => ({ requireAuthenticatedUser, finalizeAuthenticatedResponse }))
vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/lib/stellar/indexer", () => ({
  createStellarIndexer: vi.fn(() => ({
    sync,
  })),
}))

import { POST } from "@/app/api/admin/stellar/sync/route"

function buildRequest() {
  return new Request("http://localhost/api/admin/stellar/sync", {
    method: "POST",
  })
}

function buildUser(overrides: Record<string, unknown> = {}): Record<string, any> {
  return {
    _id: "admin-1",
    name: "Admin User",
    email: "admin@example.com",
    role: "admin",
    ...overrides,
  }
}

describe("POST /api/admin/stellar/sync", () => {
  beforeEach(() => {
    requireAuthenticatedUser.mockReset()
    finalizeAuthenticatedResponse.mockClear()
    sync.mockReset()
  })

  it("returns 401/error if not authenticated as admin", async () => {
    requireAuthenticatedUser.mockResolvedValue({
      response: NextResponse.json({ message: "Unauthorized" }, { status: 401 }),
    })

    const response = await POST(buildRequest())
    expect(response.status).toBe(401)
    expect(sync).not.toHaveBeenCalled()
  })

  it("triggers sync and returns metrics when authenticated as admin", async () => {
    const user = buildUser()
    requireAuthenticatedUser.mockResolvedValue({ user })
    sync.mockResolvedValue({
      processed: 5,
      duplicates: 2,
      errors: 0,
      lastCursor: "cursor-123",
    })

    const response = await POST(buildRequest())
    const payload = await response.json()

    expect(response.status).toBe(200)
    expect(sync).toHaveBeenCalledTimes(1)
    expect(payload.success).toBe(true)
    expect(payload.processed).toBe(5)
    expect(payload.duplicates).toBe(2)
    expect(payload.errors).toBe(0)
    expect(payload.lastCursor).toBe("cursor-123")
  })
})
