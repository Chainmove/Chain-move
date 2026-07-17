import mongoose from "mongoose"
import { afterAll, afterEach, beforeAll, vi } from "vitest"
import { MongoMemoryReplSet } from "mongodb-memory-server"

let database: MongoMemoryReplSet
const originalFetch = globalThis.fetch

beforeAll(async () => {
  database = await MongoMemoryReplSet.create({ replSet: { count: 1, storageEngine: "wiredTiger" } })
  process.env.MONGODB_URI = database.getUri("chainmove-integration")
  process.env.JWT_SECRET = "integration-session-key"
  process.env.PAYSTACK_SECRET_KEY = "integration-paystack-key"
  process.env.ENABLE_MOCK_PAYMENTS = "true"
  process.env.ENABLE_MOCK_EMAILS = "true"
  process.env.ENABLE_MOCK_STELLAR = "true"
  process.env.NEXT_PUBLIC_APP_URL = "http://chainmove.test"
  await mongoose.connect(process.env.MONGODB_URI)
  global.mongooseCache = { conn: mongoose, promise: Promise.resolve(mongoose) }
  await Promise.all(Object.values(mongoose.models).map(model => model.init()))
})

afterEach(async () => {
  vi.restoreAllMocks()
  globalThis.fetch = originalFetch
  if (mongoose.connection.db) {
    await Promise.all(
      Object.values(mongoose.connection.collections).map(collection => collection.deleteMany({})),
    )
  }
})

afterAll(async () => {
  await mongoose.disconnect()
  global.mongooseCache = { conn: null, promise: null }
  await database?.stop()
})
