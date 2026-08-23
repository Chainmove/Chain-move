import { beforeEach, describe, expect, it, vi } from "vitest"

const { requireAuthenticatedUser, finalizeAuthenticatedResponse, find, countDocuments, updateMany, updateOne } = vi.hoisted(
  () => ({
    requireAuthenticatedUser: vi.fn(),
    finalizeAuthenticatedResponse: vi.fn(async (response: unknown) => response),
    find: vi.fn(),
    countDocuments: vi.fn(),
    updateMany: vi.fn(),
    updateOne: vi.fn(),
  }),
)

vi.mock("@/lib/api/route-guard", () => ({ requireAuthenticatedUser, finalizeAuthenticatedResponse }))
vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/models/Notification", () => ({ default: { find, countDocuments, updateMany, updateOne } }))

import { GET, PATCH } from "@/app/api/activity/route"

/** Route handlers are typed as possibly returning nothing; fail loudly instead. */
function expectResponse(response: Response | undefined): Response {
  if (!response) throw new Error("route handler returned no response")
  return response
}

const USER_ID = "507f1f77bcf86cd799439011"
const ACTIVITY_ID = "507f1f77bcf86cd799439021"

/**
 * A tiny stand-in for the Notification collection so read state has one place
 * to live in these tests, exactly as it does in production.
 */
function createStore(seed: Array<{ _id: string; read: boolean }>) {
  const rows = seed.map((row) => ({
    ...row,
    userId: USER_ID,
    title: "Notice",
    message: "Body",
    type: "info",
    category: "system" as const,
    priority: "low" as const,
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
  }))

  find.mockImplementation(() => ({
    sort: () => ({ limit: () => ({ lean: async () => rows }) }),
  }))
  countDocuments.mockImplementation(async () => rows.filter((row) => !row.read).length)
  updateMany.mockImplementation(async (_filter: unknown, update: { $set: { read: boolean } }) => {
    for (const row of rows) row.read = update.$set.read
    return { modifiedCount: rows.length }
  })
  updateOne.mockImplementation(async (filter: { _id: string }, update: { $set: { read: boolean } }) => {
    const row = rows.find((candidate) => candidate._id === filter._id)
    if (!row) return { matchedCount: 0, modifiedCount: 0 }
    row.read = update.$set.read
    return { matchedCount: 1, modifiedCount: 1 }
  })

  return rows
}

function patchRequest(body: Record<string, unknown>) {
  return new Request("http://localhost/api/activity", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  })
}

describe("/api/activity read state", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requireAuthenticatedUser.mockResolvedValue({
      user: { _id: { toString: () => USER_ID }, role: "driver", name: "Driver" },
    })
  })

  it("reports the unread count from the notification collection", async () => {
    createStore([
      { _id: ACTIVITY_ID, read: false },
      { _id: "507f1f77bcf86cd799439022", read: true },
      { _id: "507f1f77bcf86cd799439023", read: false },
    ])

    const response = expectResponse(await GET(new Request("http://localhost/api/activity")))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toMatchObject({ unreadCount: 2 })
  })

  it("returns a zero unread count immediately after mark-all-read", async () => {
    createStore([
      { _id: ACTIVITY_ID, read: false },
      { _id: "507f1f77bcf86cd799439022", read: false },
    ])

    const patched = expectResponse(await PATCH(patchRequest({ action: "mark-all-read" })))
    await expect(patched.json()).resolves.toMatchObject({ success: true, unreadCount: 0 })

    // The next read agrees with the mutation response — there is no second
    // store left holding a stale count.
    const refetched = expectResponse(await GET(new Request("http://localhost/api/activity")))
    await expect(refetched.json()).resolves.toMatchObject({ unreadCount: 0 })
  })

  it("returns the decremented count after a single set-read", async () => {
    createStore([
      { _id: ACTIVITY_ID, read: false },
      { _id: "507f1f77bcf86cd799439022", read: false },
    ])

    const patched = expectResponse(
      await PATCH(patchRequest({ action: "set-read", activityId: ACTIVITY_ID, read: true })),
    )
    await expect(patched.json()).resolves.toMatchObject({ success: true, unreadCount: 1 })

    const refetched = expectResponse(await GET(new Request("http://localhost/api/activity")))
    await expect(refetched.json()).resolves.toMatchObject({ unreadCount: 1 })
  })

  it("scopes set-read to the caller and 404s on someone else's activity", async () => {
    createStore([{ _id: ACTIVITY_ID, read: false }])

    const response = expectResponse(
      await PATCH(patchRequest({ action: "set-read", activityId: "507f1f77bcf86cd799439099", read: true })),
    )

    expect(response.status).toBe(404)
    expect(updateOne).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID }),
      expect.objectContaining({ $set: { read: true } }),
    )
  })
})
