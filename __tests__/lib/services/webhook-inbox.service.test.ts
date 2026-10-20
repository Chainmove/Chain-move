// @vitest-environment node
/**
 * Unit tests for webhook-inbox.service.ts
 *
 * These tests exercise the pure logic that does not require a live database:
 * payload hashing, retry scheduling, and the exported helper functions.
 */
import { describe, it, expect } from "vitest"
import { hashPayload, computeNextRetryAt } from "@/models/WebhookInboxEvent"

describe("hashPayload", () => {
  it("returns a 64-character hex string (SHA-256)", () => {
    const hash = hashPayload('{"event":"charge.success"}')
    expect(hash).toMatch(/^[0-9a-f]{64}$/)
  })

  it("produces the same hash for identical payloads (deterministic)", () => {
    const payload = '{"event":"charge.success","data":{"id":1}}'
    expect(hashPayload(payload)).toBe(hashPayload(payload))
  })

  it("produces different hashes for different payloads", () => {
    expect(hashPayload('{"amount":100}')).not.toBe(hashPayload('{"amount":200}'))
  })
})

describe("computeNextRetryAt", () => {
  it("schedules first retry ~30 seconds in the future", () => {
    const before = Date.now()
    const retryAt = computeNextRetryAt(1)
    const after = Date.now()
    const delayMs = retryAt.getTime() - before
    // Allow up to 200 ms of execution time
    expect(delayMs).toBeGreaterThanOrEqual(29_800)
    expect(delayMs).toBeLessThanOrEqual(30_200 + (after - before))
  })

  it("uses exponential backoff — each attempt is longer than the last", () => {
    const delays = [1, 2, 3, 4].map(
      (attempt) => computeNextRetryAt(attempt).getTime() - Date.now(),
    )
    for (let i = 1; i < delays.length; i++) {
      expect(delays[i]).toBeGreaterThan(delays[i - 1])
    }
  })

  it("caps the delay at 2 hours (7200 seconds)", () => {
    const retryAt = computeNextRetryAt(10) // well past the cap
    const delayMs = retryAt.getTime() - Date.now()
    expect(delayMs).toBeLessThanOrEqual(7_200_000 + 200)
  })
})
