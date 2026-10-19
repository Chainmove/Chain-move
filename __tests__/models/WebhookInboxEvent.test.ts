// @vitest-environment node
import { describe, it, expect } from "vitest"
import { hashPayload, computeNextRetryAt } from "@/models/WebhookInboxEvent"

describe("WebhookInboxEvent helpers", () => {
  it("hashPayload returns a 64-char hex string", () => {
    const hash = hashPayload('{"event":"charge.success"}')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("hashPayload is deterministic", () => {
    const body = '{"event":"charge.success","data":{"reference":"ref_001"}}'
    expect(hashPayload(body)).toBe(hashPayload(body))
  })

  it("hashPayload differs for different payloads", () => {
    expect(hashPayload("abc")).not.toBe(hashPayload("def"))
  })

  it("computeNextRetryAt returns a date in the future", () => {
    const before = Date.now()
    const next = computeNextRetryAt(1)
    expect(next.getTime()).toBeGreaterThan(before)
  })

  it("computeNextRetryAt uses exponential backoff (attempt 2 > attempt 1)", () => {
    const retry1 = computeNextRetryAt(1)
    const retry2 = computeNextRetryAt(2)
    expect(retry2.getTime()).toBeGreaterThan(retry1.getTime())
  })

  it("computeNextRetryAt caps at 2 hours", () => {
    const retry10 = computeNextRetryAt(10)
    const twoHoursMs = 7200 * 1000
    expect(retry10.getTime() - Date.now()).toBeLessThanOrEqual(twoHoursMs + 100)
  })
})
