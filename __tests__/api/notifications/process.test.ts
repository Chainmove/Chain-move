// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("@/lib/notifications/service", () => ({ processEmailJobs: vi.fn().mockResolvedValue({ processed: 0 }) }))

import { POST } from "@/app/api/notifications/process/route"
import { processEmailJobs } from "@/lib/notifications/service"

const SECRET = "test-worker-secret"

function requestWithAuth(authorization: string | null) {
  const headers = new Headers()
  if (authorization !== null) headers.set("authorization", authorization)
  return new Request("https://example.com/api/notifications/process", { method: "POST", headers })
}

describe("POST /api/notifications/process — bearer token validation", () => {
  const originalSecret = process.env.NOTIFICATION_WORKER_SECRET

  beforeEach(() => {
    process.env.NOTIFICATION_WORKER_SECRET = SECRET
    vi.mocked(processEmailJobs).mockClear()
  })

  afterEach(() => {
    process.env.NOTIFICATION_WORKER_SECRET = originalSecret
  })

  it("rejects a missing Authorization header with 401", async () => {
    const response = await POST(requestWithAuth(null))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
    expect(processEmailJobs).not.toHaveBeenCalled()
  })

  it("rejects a malformed header (no Bearer prefix) with 401", async () => {
    const response = await POST(requestWithAuth(SECRET))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
  })

  it("rejects a short (truncated) token with 401", async () => {
    const response = await POST(requestWithAuth(`Bearer ${SECRET.slice(0, 5)}`))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
  })

  it("rejects a long token with 401", async () => {
    const response = await POST(requestWithAuth(`Bearer ${SECRET}-extra-suffix`))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
  })

  it("rejects a same-length but wrong token with 401", async () => {
    const wrongSameLength = SECRET.replace(/./g, "x")
    const response = await POST(requestWithAuth(`Bearer ${wrongSameLength}`))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ error: "Unauthorized" })
  })

  it("accepts the correct bearer token and runs the job", async () => {
    const response = await POST(requestWithAuth(`Bearer ${SECRET}`))
    expect(response.status).toBe(200)
    expect(processEmailJobs).toHaveBeenCalledTimes(1)
  })

  it("rejects every request with 401 when the worker secret is not configured server-side, even with a token supplied", async () => {
    delete process.env.NOTIFICATION_WORKER_SECRET
    const response = await POST(requestWithAuth(`Bearer ${SECRET}`))
    expect(response.status).toBe(401)
    expect(processEmailJobs).not.toHaveBeenCalled()
  })

  it("responds identically (status + body shape) across missing, malformed, short, long, and wrong tokens", async () => {
    const cases = [null, SECRET, `Bearer ${SECRET.slice(0, 5)}`, `Bearer ${SECRET}-extra`, `Bearer ${"x".repeat(SECRET.length)}`]
    const results = await Promise.all(
      cases.map(async (authorization) => {
        const response = await POST(requestWithAuth(authorization))
        return { status: response.status, body: await response.json() }
      }),
    )
    for (const result of results) {
      expect(result).toEqual({ status: 401, body: { error: "Unauthorized" } })
    }
  })
})
