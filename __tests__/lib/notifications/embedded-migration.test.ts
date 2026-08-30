import { beforeEach, describe, expect, it, vi } from "vitest"

const { userFind, userUpdateOne, notificationUpdateOne } = vi.hoisted(() => ({
  userFind: vi.fn(),
  userUpdateOne: vi.fn(),
  notificationUpdateOne: vi.fn(),
}))

vi.mock("@/lib/dbConnect", () => ({ default: vi.fn() }))
vi.mock("@/models/User", () => ({ default: { find: userFind, updateOne: userUpdateOne } }))
vi.mock("@/models/Notification", () => ({ default: { updateOne: notificationUpdateOne } }))

import { deriveNotificationId, migrateEmbeddedNotifications } from "@/lib/notifications/embedded-migration"

const USER_ID = "507f1f77bcf86cd799439011"
const EMBEDDED_ID = "507f1f77bcf86cd799439021"

interface FakeUser {
  _id: { toString: () => string }
  notifications?: Array<Record<string, unknown>>
}

/**
 * Minimal in-memory stand-ins for the two collections, so the migration's
 * upsert/merge/unset behaviour is exercised end to end without a live Mongo.
 */
function createWorld(users: Array<{ id: string; notifications: Array<Record<string, unknown>> }>) {
  const store = new Map<string, Record<string, any>>()
  const failingIds = new Set<string>()
  const documents: FakeUser[] = users.map((user) => ({
    _id: { toString: () => user.id },
    notifications: user.notifications,
  }))

  userFind.mockImplementation(() => ({
    select: () => ({
      lean: async () => documents.filter((doc) => Array.isArray(doc.notifications) && doc.notifications.length > 0),
    }),
  }))

  userUpdateOne.mockImplementation(async (filter: { _id: { toString: () => string } }, update: any) => {
    const doc = documents.find((candidate) => candidate._id.toString() === filter._id.toString())
    if (doc && update?.$unset && "notifications" in update.$unset) delete doc.notifications
    return { modifiedCount: 1 }
  })

  notificationUpdateOne.mockImplementation(async (filter: any, update: any, options?: { upsert?: boolean }) => {
    const id = String(filter._id)
    if (failingIds.has(id)) throw new Error("simulated write failure")

    const existing = store.get(id)
    if (!existing) {
      if (!options?.upsert) return { upsertedCount: 0, modifiedCount: 0, matchedCount: 0 }
      store.set(id, { _id: id, ...update.$setOnInsert })
      return { upsertedCount: 1, modifiedCount: 0, matchedCount: 0 }
    }

    if (filter.userId !== undefined && existing.userId !== filter.userId) {
      return { upsertedCount: 0, modifiedCount: 0, matchedCount: 0 }
    }
    if (filter.read !== undefined && existing.read !== filter.read) {
      return { upsertedCount: 0, modifiedCount: 0, matchedCount: 0 }
    }
    if (!update.$set) return { upsertedCount: 0, modifiedCount: 0, matchedCount: 1 }

    Object.assign(existing, update.$set)
    return { upsertedCount: 0, modifiedCount: 1, matchedCount: 1 }
  })

  return { store, failingIds, documents }
}

function legacyEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: EMBEDDED_ID,
    title: "KYC approved",
    message: "Your KYC has been approved.",
    read: false,
    timestamp: new Date("2026-01-01T00:00:00.000Z"),
    link: "/dashboard/driver/activity",
    ...overrides,
  }
}

describe("migrateEmbeddedNotifications", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("derives a stable id from an embedded ObjectId", () => {
    expect(deriveNotificationId(USER_ID, legacyEntry())).toBe(EMBEDDED_ID)
  })

  it("derives a stable id for legacy entries with no usable id", () => {
    const entry = legacyEntry({ id: "not-an-object-id" })
    const first = deriveNotificationId(USER_ID, entry)

    expect(first).toMatch(/^[a-f\d]{24}$/)
    expect(deriveNotificationId(USER_ID, entry)).toBe(first)
    expect(deriveNotificationId("507f1f77bcf86cd799439099", entry)).not.toBe(first)
  })

  it("backfills embedded notifications and unsets the array", async () => {
    const world = createWorld([{ id: USER_ID, notifications: [legacyEntry()] }])

    const result = await migrateEmbeddedNotifications()

    expect(result).toMatchObject({ usersScanned: 1, usersCleared: 1, notificationsCreated: 1, errors: [] })
    expect(world.store.get(EMBEDDED_ID)).toMatchObject({
      userId: USER_ID,
      title: "KYC approved",
      read: false,
      link: "/dashboard/driver/activity",
    })
    expect(world.documents[0].notifications).toBeUndefined()
  })

  it("promotes read state recorded only on the embedded copy", async () => {
    const world = createWorld([{ id: USER_ID, notifications: [legacyEntry({ read: true })] }])
    world.store.set(EMBEDDED_ID, { _id: EMBEDDED_ID, userId: USER_ID, read: false })

    const result = await migrateEmbeddedNotifications()

    expect(result).toMatchObject({ notificationsCreated: 0, notificationsReconciled: 1 })
    expect(world.store.get(EMBEDDED_ID)).toMatchObject({ read: true })
  })

  it("never un-reads a notification already dismissed in the collection", async () => {
    const world = createWorld([{ id: USER_ID, notifications: [legacyEntry({ read: false })] }])
    world.store.set(EMBEDDED_ID, { _id: EMBEDDED_ID, userId: USER_ID, read: true })

    const result = await migrateEmbeddedNotifications()

    expect(result).toMatchObject({ notificationsCreated: 0, notificationsReconciled: 0, notificationsSkipped: 1 })
    expect(world.store.get(EMBEDDED_ID)).toMatchObject({ read: true })
  })

  it("skips entries the Notification schema could not accept", async () => {
    const world = createWorld([
      { id: USER_ID, notifications: [legacyEntry({ title: "   " }), legacyEntry({ id: "x", message: "" })] },
    ])

    const result = await migrateEmbeddedNotifications()

    expect(result).toMatchObject({ notificationsCreated: 0, notificationsSkipped: 2, usersCleared: 1 })
    expect(world.store.size).toBe(0)
  })

  it("keeps the embedded array after a partial write failure and finishes on re-run without duplicating", async () => {
    const secondId = "507f1f77bcf86cd799439022"
    const world = createWorld([
      {
        id: USER_ID,
        notifications: [legacyEntry(), legacyEntry({ id: secondId, title: "Payout sent" })],
      },
    ])
    world.failingIds.add(secondId)

    const first = await migrateEmbeddedNotifications()

    expect(first.errors).toHaveLength(1)
    expect(first).toMatchObject({ notificationsCreated: 1, usersCleared: 0 })
    // The array survives so nothing is lost.
    expect(world.documents[0].notifications).toHaveLength(2)

    world.failingIds.clear()
    const second = await migrateEmbeddedNotifications()

    expect(second).toMatchObject({ notificationsCreated: 1, usersCleared: 1, errors: [] })
    // The already-migrated entry was not written a second time.
    expect(world.store.size).toBe(2)
    expect(world.documents[0].notifications).toBeUndefined()
  })

  it("writes nothing in dry-run mode", async () => {
    const world = createWorld([{ id: USER_ID, notifications: [legacyEntry()] }])

    const result = await migrateEmbeddedNotifications({ dryRun: true })

    expect(result).toMatchObject({ usersScanned: 1, usersCleared: 0, notificationsCreated: 1 })
    expect(notificationUpdateOne).not.toHaveBeenCalled()
    expect(userUpdateOne).not.toHaveBeenCalled()
    expect(world.documents[0].notifications).toHaveLength(1)
  })

  it("handles a high-volume legacy user in a single pass", async () => {
    const notifications = Array.from({ length: 500 }, (_, index) =>
      legacyEntry({ id: `legacy-${index}`, title: `Notice ${index}` }),
    )
    const world = createWorld([{ id: USER_ID, notifications }])

    const result = await migrateEmbeddedNotifications()

    expect(result).toMatchObject({ notificationsCreated: 500, usersCleared: 1, errors: [] })
    expect(world.store.size).toBe(500)
    expect(world.documents[0].notifications).toBeUndefined()
  })
})
