import { afterEach, describe, expect, it } from "vitest"

import { GET } from "@/app/api/health/route"

const originalMongoUri = process.env.MONGODB_URI
const originalJwtSecret = process.env.JWT_SECRET

afterEach(() => {
  process.env.MONGODB_URI = originalMongoUri
  process.env.JWT_SECRET = originalJwtSecret
})

describe("health endpoint", () => {
  it("changes readiness without exposing configuration", async () => {
    process.env.MONGODB_URI = "mongodb://private-host/chainmove"
    process.env.JWT_SECRET = "not-for-response"
    const ready = await GET()
    expect(ready.status).toBe(200)
    expect(await ready.json()).toEqual({ status: "ready", checks: { configuration: "ok" } })

    delete process.env.JWT_SECRET
    const degraded = await GET()
    expect(degraded.status).toBe(503)
    expect(JSON.stringify(await degraded.json())).not.toContain("private-host")
  })
})
