import { describe, it, expect } from "vitest"
import { exportToCSV, createAuditCsvStream } from "@/lib/security/audit-export"

function buildEvent(overrides: Record<string, unknown> = {}) {
  return {
    sequence: 1,
    eventId: "evt-1",
    timestamp: new Date("2026-04-01T00:00:00.000Z"),
    actorId: "actor-1",
    actorRole: "admin",
    action: "user.update",
    targetType: "user",
    targetId: "user-1",
    status: "success",
    requestId: "req-1",
    ipAddress: "127.0.0.1",
    previousHash: "hash-0",
    eventHash: "hash-1",
    isLegacy: false,
    ...overrides,
  }
}

async function* toAsync<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) yield item
}

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  return new Response(stream).text()
}

describe("exportToCSV", () => {
  it("neutralizes a formula-injection payload in the actor id", () => {
    const csv = exportToCSV([buildEvent({ actorId: "=cmd|' /C calc'!A0" })])
    const lines = csv.split("\n")
    expect(lines[1]).toContain("'=cmd|' /C calc'!A0")
  })

  it("escapes an embedded double quote instead of corrupting the row (prior implementation did not escape quotes)", () => {
    const csv = exportToCSV([buildEvent({ targetId: 'user-"admin"-1' })])
    const lines = csv.split("\n")
    expect(lines[1]).toContain(`"user-""admin""-1"`)
  })

  it("preserves the numeric sequence column untouched", () => {
    const csv = exportToCSV([buildEvent({ sequence: 42 })])
    const lines = csv.split("\n")
    expect(lines[1].startsWith("42,")).toBe(true)
  })

  it("round-trips an ordinary event with no dangerous content", () => {
    const csv = exportToCSV([buildEvent()])
    const lines = csv.split("\n")
    expect(lines[1]).toBe("1,evt-1,2026-04-01T00:00:00.000Z,actor-1,admin,user.update,user,user-1,success,req-1,127.0.0.1,hash-0,hash-1,false")
  })
})

describe("createAuditCsvStream", () => {
  it("neutralizes a formula-injection payload streamed end to end", async () => {
    const stream = createAuditCsvStream(toAsync([buildEvent({ action: "+cmd|' /C calc'!A0" })]))
    const text = await readStream(stream)
    expect(text).toContain("'+cmd|' /C calc'!A0")
  })
})
