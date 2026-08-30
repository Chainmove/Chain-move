import { describe, expect, it } from "vitest"
import {
  buildCanonicalAuditEventData,
  canonicalizeEventData,
  computeEventHash,
  getGenesisHash,
} from "./audit-hash"
import { verifyAuditExportPayload } from "./audit-verification"

function buildEvent(overrides: Record<string, unknown> = {}) {
  const base = {
    sequence: 0,
    eventId: "evt-1",
    actorId: "actor-1",
    actorRole: "admin",
    action: "kyc.approve",
    targetType: "user",
    targetId: "user-1",
    status: "success",
    requestId: "req-1",
    metadata: { after: "approved", before: "pending" },
    timestamp: "2026-07-23T12:00:00.000Z",
    partition: "2026-07",
    previousHash: getGenesisHash("2026-07"),
    isLegacy: false,
    ...overrides,
  }
  const event = {
    ...base,
    previousHash: String(base.previousHash),
  }
  const canonicalData = canonicalizeEventData(buildCanonicalAuditEventData(event))
  const eventHash = computeEventHash(event.previousHash + canonicalData)

  return {
    ...event,
    canonicalData,
    eventHash,
  }
}

describe("audit hash canonicalization", () => {
  it("is stable for equivalent object key ordering", () => {
    const first = canonicalizeEventData({
      z: 1,
      a: { b: 2, a: 1 },
      list: [{ y: true, x: false }],
    })
    const second = canonicalizeEventData({
      list: [{ x: false, y: true }],
      a: { a: 1, b: 2 },
      z: 1,
    })

    expect(first).toBe(second)
  })

  it("verifies an intact offline export", () => {
    const first = buildEvent()
    const second = buildEvent({
      sequence: 1,
      eventId: "evt-2",
      previousHash: first.eventHash,
      action: "wallet.credit",
    })

    const result = verifyAuditExportPayload({
      manifest: {
        partition: "2026-07",
        startSequence: 0,
        endSequence: 1,
        startEventHash: first.eventHash,
        endEventHash: second.eventHash,
      },
      events: [first, second],
    })

    expect(result.valid).toBe(true)
  })

  it("detects modified exported events", () => {
    const event = buildEvent()
    const result = verifyAuditExportPayload({
      manifest: {
        partition: "2026-07",
        startSequence: 0,
        endSequence: 0,
        startEventHash: event.eventHash,
        endEventHash: event.eventHash,
      },
      events: [{ ...event, action: "kyc.reject" }],
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.type === "INVALID_HASH")).toBe(true)
  })

  it("detects deleted or reordered exported events", () => {
    const first = buildEvent()
    const second = buildEvent({
      sequence: 1,
      eventId: "evt-2",
      previousHash: first.eventHash,
      action: "wallet.credit",
    })

    const result = verifyAuditExportPayload({
      manifest: {
        partition: "2026-07",
        startSequence: 0,
        endSequence: 1,
        startEventHash: first.eventHash,
        endEventHash: second.eventHash,
      },
      events: [second, first],
    })

    expect(result.valid).toBe(false)
    expect(result.errors.some((error) => error.type === "BROKEN_CHAIN" || error.type === "MISSING_SEQUENCE")).toBe(true)
  })
})
