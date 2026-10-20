// @vitest-environment node
import { describe, it, expect } from "vitest"
import {
  isPoolAcceptingInvestments,
  resolvePoolStatus,
} from "@/lib/services/pool-lifecycle.service"
import type { PoolStatus } from "@/models/InvestmentPool"

describe("pool lifecycle — resolvePoolStatus", () => {
  it("normalises legacy OPEN to funding", () => {
    expect(resolvePoolStatus("OPEN")).toBe("funding")
  })

  it("normalises legacy FUNDED to fully_funded", () => {
    expect(resolvePoolStatus("FUNDED")).toBe("fully_funded")
  })

  it("normalises legacy CLOSED to completed", () => {
    expect(resolvePoolStatus("CLOSED")).toBe("completed")
  })

  it("passes canonical statuses through unchanged", () => {
    const statuses: PoolStatus[] = [
      "draft", "review", "funding", "fully_funded",
      "closing", "active", "paused", "completed",
      "cancelled", "archived",
    ]
    for (const s of statuses) {
      expect(resolvePoolStatus(s)).toBe(s)
    }
  })
})

describe("pool lifecycle — isPoolAcceptingInvestments", () => {
  it("returns true only for funding status", () => {
    expect(isPoolAcceptingInvestments("funding")).toBe(true)
    expect(isPoolAcceptingInvestments("OPEN")).toBe(true) // legacy alias
  })

  it("returns false for non-funding statuses", () => {
    const closed: PoolStatus[] = [
      "draft", "review", "fully_funded", "closing",
      "active", "paused", "completed", "cancelled", "archived",
      "FUNDED", "CLOSED",
    ]
    for (const s of closed) {
      expect(isPoolAcceptingInvestments(s)).toBe(false)
    }
  })
})
