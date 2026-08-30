// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach } from "vitest"
import crypto from "crypto"

import { POST } from "@/app/api/payments/webhook/route"

const SECRET = "test-paystack-secret"

function requestWithSignature(body: string, signature: string | null) {
  const headers = new Headers()
  if (signature !== null) headers.set("x-paystack-signature", signature)
  return new Request("https://example.com/api/payments/webhook", {
    method: "POST",
    headers,
    body,
  })
}

function validHash(body: string) {
  return crypto.createHmac("sha512", SECRET).update(body).digest("hex")
}

// Any unsupported event name lets the route return { status: "ignored" }
// immediately after the signature check, with no DB/service calls needed —
// exactly enough to prove the signature guard passed without pulling in the
// unrelated event-processing pipeline this issue doesn't touch.
const IGNORED_EVENT_BODY = JSON.stringify({ event: "not.a.supported.event", data: {} })

describe("POST /api/payments/webhook — signature validation", () => {
  const originalSecret = process.env.PAYSTACK_SECRET_KEY

  beforeEach(() => {
    process.env.PAYSTACK_SECRET_KEY = SECRET
  })

  afterEach(() => {
    process.env.PAYSTACK_SECRET_KEY = originalSecret
  })

  it("rejects a missing signature header with 401 and a generic message", async () => {
    const response = await POST(requestWithSignature(IGNORED_EVENT_BODY, null))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ message: "Invalid signature." })
  })

  it("rejects a malformed (non-hex) signature with 401", async () => {
    const malformed = "z".repeat(128) // right length, invalid hex charset
    const response = await POST(requestWithSignature(IGNORED_EVENT_BODY, malformed))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ message: "Invalid signature." })
  })

  it("rejects a short signature with 401", async () => {
    const short = validHash(IGNORED_EVENT_BODY).slice(0, 10)
    const response = await POST(requestWithSignature(IGNORED_EVENT_BODY, short))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ message: "Invalid signature." })
  })

  it("rejects a long signature with 401", async () => {
    const long = validHash(IGNORED_EVENT_BODY) + "ff"
    const response = await POST(requestWithSignature(IGNORED_EVENT_BODY, long))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ message: "Invalid signature." })
  })

  it("rejects a correctly-formatted but wrong-value signature with 401", async () => {
    const wrongButValidShape = "a".repeat(128)
    const response = await POST(requestWithSignature(IGNORED_EVENT_BODY, wrongButValidShape))
    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ message: "Invalid signature." })
  })

  it("accepts a correct signature and proceeds past the auth guard", async () => {
    const signature = validHash(IGNORED_EVENT_BODY)
    const response = await POST(requestWithSignature(IGNORED_EVENT_BODY, signature))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ status: "ignored" })
  })

  it("responds identically (status + body shape) for missing vs malformed vs wrong signatures", async () => {
    const cases = [null, "z".repeat(128), "a".repeat(128), validHash(IGNORED_EVENT_BODY).slice(0, 10)]
    const results = await Promise.all(
      cases.map(async (signature) => {
        const response = await POST(requestWithSignature(IGNORED_EVENT_BODY, signature))
        return { status: response.status, body: await response.json() }
      }),
    )
    for (const result of results) {
      expect(result).toEqual({ status: 401, body: { message: "Invalid signature." } })
    }
  })
})
