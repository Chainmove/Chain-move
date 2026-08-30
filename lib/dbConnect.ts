import mongoose from "mongoose"
import { logger } from "@/lib/observability/logger"
import { incrementMetric, recordLatency } from "@/lib/observability/metrics"

type MongooseCache = {
  conn: typeof mongoose | null
  promise: Promise<typeof mongoose> | null
}

declare global {
  var mongooseCache: MongooseCache | undefined
}

const cached = global.mongooseCache || { conn: null, promise: null }

if (!global.mongooseCache) {
  global.mongooseCache = cached
}

function getMongoDbUri() {
  const uri = process.env.MONGODB_URI?.trim()
  if (!uri) {
    throw new Error("Please define the MONGODB_URI environment variable inside .env.local or the deployment environment.")
  }

  return uri
}

async function dbConnect() {
  if (cached.conn) {
    return cached.conn
  }

  if (!cached.promise) {
    cached.promise = mongoose.connect(getMongoDbUri(), {
      bufferCommands: false,
    })
  }

  const startedAt = performance.now()
  try {
    cached.conn = await cached.promise
    recordLatency("database.connect", performance.now() - startedAt)
    incrementMetric("database.operations", "success")
  } catch (error) {
    cached.promise = null
    incrementMetric("database.failures", "connect")
    logger.error({ event: "database.connect.failed", error })
    throw error
  }
  return cached.conn
}

// Mongoose's debug hook is intentionally enabled only outside production. It
// captures query shape without logging values that can be personal or financial
// data; explicit explain plans remain a local investigation tool.
if (process.env.NODE_ENV !== "production") {
  mongoose.set("debug", (collection: string, method: string, query: unknown) => {
    incrementMetric("database.operations", method)
    logger.debug({
      event: "database.query",
      collection,
      method,
      queryShape: Object.keys((query || {}) as Record<string, unknown>),
    })
  })
}

export default dbConnect
