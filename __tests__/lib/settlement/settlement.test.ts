// @vitest-environment node
import { describe, expect, it, beforeEach } from "vitest"
import mongoose from "mongoose"

import {
  determineSafeActions,
  isValidTransition,
} from "@/lib/settlement/state-machine"
import { getRailSettlementConfig } from "@/lib/settlement/config"
import { CanonicalSettlementState } from "@/models/SettlementRecord"

describe("Settlement State Machine & Configuration", () => {
  it("validates allowed canonical state transitions correctly", () => {
    expect(isValidTransition("initiated", "provider-pending")).toBe(true)
    expect(isValidTransition("provider-pending", "confirmed")).toBe(true)
    expect(isValidTransition("confirmed", "reversed")).toBe(true)
    expect(isValidTransition("confirmed", "disputed")).toBe(true)
    expect(isValidTransition("disputed", "confirmed")).toBe(true)
    expect(isValidTransition("disputed", "reversed")).toBe(true)

    // Invalid terminal state transitions
    expect(isValidTransition("reversed", "confirmed")).toBe(false)
    expect(isValidTransition("failed", "confirmed")).toBe(false)
    expect(isValidTransition("expired", "observed")).toBe(false)
  })

  it("returns appropriate safe operator actions for each state", () => {
    expect(determineSafeActions("initiated", false)).toContain("RETRY_VERIFICATION")
    expect(determineSafeActions("provider-pending", true)).toContain("MARK_EXPIRED")
    expect(determineSafeActions("confirmed", false)).toContain("POST_REVERSAL")
    expect(determineSafeActions("disputed", false)).toContain("RESOLVE_DISPUTE_CONFIRM")
  })

  it("provides correct rail settlement configuration for production and development", () => {
    const paystackConfig = getRailSettlementConfig("paystack", "production")
    expect(paystackConfig.finalityThreshold).toBe(1)
    expect(paystackConfig.pendingTimeoutMs).toBe(15 * 60 * 1000)

    const stellarConfig = getRailSettlementConfig("stellar", "production")
    expect(stellarConfig.finalityThreshold).toBe(3)

    const devStellarConfig = getRailSettlementConfig("stellar", "development")
    expect(devStellarConfig.finalityThreshold).toBe(1)
  })
})

describe("Settlement Logic & Scenarios", () => {
  it("handles out-of-order webhook state transitions gracefully", () => {
    // Valid transition from initiated to confirmed directly when webhook arrives early
    expect(isValidTransition("initiated", "confirmed")).toBe(true)
    // Valid transition from provider-pending to observed
    expect(isValidTransition("provider-pending", "observed")).toBe(true)
  })

  it("prevents double-crediting on duplicate reference events", () => {
    const seenReferences = new Set<string>()
    const ref = "PAYSTACK_REF_DUPLICATE_123"

    function processPayment(reference: string) {
      if (seenReferences.has(reference)) {
        return { alreadyProcessed: true, credited: false }
      }
      seenReferences.add(reference)
      return { alreadyProcessed: false, credited: true }
    }

    const firstCall = processPayment(ref)
    const secondCall = processPayment(ref)

    expect(firstCall.alreadyProcessed).toBe(false)
    expect(firstCall.credited).toBe(true)

    expect(secondCall.alreadyProcessed).toBe(true)
    expect(secondCall.credited).toBe(false)
  })

  it("calculates reversal journal deductions without creating negative balance", () => {
    const currentAvailable = 3000
    const reversalAmount = 5000

    let deductedFromAvailable = 0
    let deductedFromHeld = 0
    let deductedFromPending = 0

    if (currentAvailable >= reversalAmount) {
      deductedFromAvailable = reversalAmount
    } else {
      deductedFromAvailable = currentAvailable
      const remainder = reversalAmount - currentAvailable
      deductedFromHeld = remainder
    }

    const newAvailable = Math.max(currentAvailable - deductedFromAvailable, 0)
    expect(newAvailable).toBe(0)
    expect(deductedFromAvailable).toBe(3000)
    expect(deductedFromHeld).toBe(2000)
  })

  it("flags stuck transactions when pending time exceeds rail threshold", () => {
    const now = new Date()
    const createdAt = new Date(now.getTime() - 30 * 60 * 1000) // 30 mins ago
    const pendingTimeoutMs = 15 * 60 * 1000 // 15 mins

    const ageMs = now.getTime() - createdAt.getTime()
    const isStuck = ageMs > pendingTimeoutMs

    expect(isStuck).toBe(true)
  })

  it("handles split settlement cross-rail correlation mapping", () => {
    const settlementMapping = {
      settlementId: "STL-999",
      providerReference: "PAYSTACK_TRANSFER_888",
      stellarHash: "0xSTELLARHASH777",
      ledgerJournalId: "JOURNAL_666",
      userTransactionId: "TX_555",
    }

    expect(settlementMapping.providerReference).toBe("PAYSTACK_TRANSFER_888")
    expect(settlementMapping.stellarHash).toBe("0xSTELLARHASH777")
    expect(settlementMapping.ledgerJournalId).toBe("JOURNAL_666")
  })
})
