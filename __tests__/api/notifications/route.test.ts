import { NextResponse } from "next/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireAuthenticatedUser, finalizeAuthenticatedResponse, logAuditEvent, notificationCreate, userExists, userFindById } =
  vi.hoisted(() => ({
    requireAuthenticatedUser: vi.fn(),
    finalizeAuthenticatedResponse: vi.fn(async (response: unknown) => response),
    logAuditEvent: vi.fn(async () => undefined),
    notificationCreate: vi.fn(),
    userExists: vi.fn(),
    userFindById: vi.fn(),
  }))

vi.mock("@/lib/api/route-guard", () => ({ requireAuthenticatedUser, finalizeAuthenticatedResponse }))
vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/lib/security/audit-log", () => ({ logAuditEvent }))
vi.mock("@/lib/security/rate-limit", () => ({
  buildRateLimitKey: (...segments: unknown[]) => segments.join(":"),
  consumeRateLimit: () => ({ allowed: true, remaining: 100, resetAt: Date.now() + 1000 }),
  getClientIpAddress: () => "127.0.0.1",
  rateLimitExceededResponse: () => new Response(JSON.stringify({ error: "Too many requests" }), { status: 429 }),
}))
vi.mock("@/models/Notification", () => ({ default: { create: notificationCreate, find: vi.fn() } }))

// Only `exists` is provided: any attempt to load or mutate the user document
// during notification creation fails loudly instead of silently dual-writing.
vi.mock("@/models/User", () => ({ default: { exists: userExists, findById: userFindById } }))

import { POST } from "@/app/api/notifications/route"

/** Route handlers are typed as possibly returning nothing; fail loudly instead. */
function expectResponse(response: Response | undefined): Response {
  if (!response) throw new Error("route handler returned no response")
  return response
}

const RECIPIENT_ID = "507f1f77bcf86cd799439011"
const ADMIN_ID = "507f1f77bcf86cd799439012"

function buildRequest(body: Record<string, unknown> = {}) {
  return new Request("http://localhost/api/notifications", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      userId: RECIPIENT_ID,
      title: "Repayment received",
      message: "Your repayment has been confirmed.",
      ...body,
    }),
  })
}

describe("POST /api/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthenticatedUser.mockResolvedValue({
      user: { _id: { toString: () => ADMIN_ID }, role: "admin", name: "Admin" },
    })
    userExists.mockResolvedValue({ _id: RECIPIENT_ID })
    notificationCreate.mockImplementation(async (doc: Record<string, unknown>) => ({
      ...doc,
      _id: { toString: () => "507f1f77bcf86cd799439013" },
    }))
  })

  it("writes the notification only to the Notification collection", async () => {
    const response = expectResponse(await POST(buildRequest()))

    expect(response.status).toBe(200)
    expect(notificationCreate).toHaveBeenCalledTimes(1)
    expect(notificationCreate.mock.calls[0][0]).toMatchObject({ userId: RECIPIENT_ID, title: "Repayment received" })

    // The old dual-write loaded the user document to append an embedded copy.
    expect(userFindById).not.toHaveBeenCalled()
  })

  it("still rejects an unknown recipient", async () => {
    userExists.mockResolvedValue(null)

    const response = expectResponse(await POST(buildRequest()))

    expect(response.status).toBe(404)
    expect(notificationCreate).not.toHaveBeenCalled()
  })

  it("keeps the user document untouched across a high volume of notifications", async () => {
    for (let index = 0; index < 200; index++) {
      const response = expectResponse(await POST(buildRequest({ title: `Notice ${index}` })))
      expect(response.status).toBe(200)
    }

    expect(notificationCreate).toHaveBeenCalledTimes(200)
    // Nothing accumulated on the user: the document was never loaded or saved,
    // so it cannot grow without bound.
    expect(userFindById).not.toHaveBeenCalled()
    expect(userExists).toHaveBeenCalledTimes(200)
  })

  it("refuses non-admin callers before touching either store", async () => {
    requireAuthenticatedUser.mockResolvedValue({
      response: NextResponse.json({ message: "Admin access required" }, { status: 403 }),
    })

    const response = expectResponse(await POST(buildRequest()))

    expect(response.status).toBe(403)
    expect(notificationCreate).not.toHaveBeenCalled()
    expect(userExists).not.toHaveBeenCalled()
  })
})
