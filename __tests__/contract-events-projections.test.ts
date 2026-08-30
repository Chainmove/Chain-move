/**
 * __tests__/contract-events-projections.test.ts
 *
 * Comprehensive tests for versioned Soroban contract events, decoders,
 * idempotent reducers, and rebuild comparison tooling.
 */

import { describe, it, expect } from "vitest"
import {
  parseContractEvent,
  IncompatibleEventVersionError,
  InvalidEventPayloadError,
  MAX_EVENT_PAYLOAD_BYTES,
} from "../lib/stellar/events/decoders"
import { reducePoolEvent, reduceRepaymentEvent } from "../lib/stellar/projections/reducers"
import { rebuildProjectionsFromEvents, compareProjections } from "../lib/stellar/projections/rebuild"
import { DecodedContractEvent, PoolTransitionPayload, RepaymentTransitionPayload } from "../types/contract-events"
import goldenEvents from "./fixtures/golden-contract-events.json"

describe("Soroban Contract Event Decoders", () => {
  it("successfully parses golden pool contract events", () => {
    const rawCreated = goldenEvents[0]
    const decodedCreated = parseContractEvent(rawCreated as any)

    expect(decodedCreated.topicCategory).toBe("chainmove_pool_v1")
    expect(decodedCreated.eventType).toBe("pool_created_v1")
    expect(decodedCreated.schemaVersion).toBe(1)
    expect((decodedCreated.payload as PoolTransitionPayload).pool_id).toBe(1)

    const rawFunded = goldenEvents[1]
    const decodedFunded = parseContractEvent(rawFunded as any)
    expect(decodedFunded.eventType).toBe("pool_funded_v1")
    expect((decodedFunded.payload as PoolTransitionPayload).amount).toBe("500000")
  })

  it("successfully parses golden repayment contract events", () => {
    const rawAssigned = goldenEvents[3]
    const decodedAssigned = parseContractEvent(rawAssigned as any)

    expect(decodedAssigned.topicCategory).toBe("repayment_v1")
    expect(decodedAssigned.eventType).toBe("driver_assigned_v1")
    expect((decodedAssigned.payload as RepaymentTransitionPayload).driver).toBe(
      "GDRIVER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    )
  })

  it("throws IncompatibleEventVersionError for unknown or future schema versions", () => {
    const rawFuture = {
      contractId: "CCMOVEPOOL123",
      ledger: 200,
      transactionHash: "tx999",
      topics: ["chainmove_pool_v1", "pool_funded_v1"],
      value: {
        version: 99, // Incompatible breaking version
        asset: "CASSET123",
        amount: "100",
        pool_id: 1,
      },
    }

    expect(() => parseContractEvent(rawFuture as any)).toThrow(IncompatibleEventVersionError)
  })

  it("throws InvalidEventPayloadError when payload exceeds size budget", () => {
    const hugeString = "X".repeat(MAX_EVENT_PAYLOAD_BYTES + 50)
    const rawBloated = {
      contractId: "CCMOVEPOOL123",
      ledger: 200,
      transactionHash: "txBloated",
      topics: ["chainmove_pool_v1", "pool_funded_v1"],
      value: {
        version: 1,
        asset: "CASSET123",
        amount: "100",
        pool_id: 1,
        reference: hugeString,
      },
    }

    expect(() => parseContractEvent(rawBloated as any)).toThrow(InvalidEventPayloadError)
  })
})

describe("Idempotent Projection Reducers", () => {
  it("idempotently reduces pool funding and repayment events", () => {
    const createdEvent = parseContractEvent(goldenEvents[0] as any) as DecodedContractEvent<PoolTransitionPayload>
    const fundedEvent = parseContractEvent(goldenEvents[1] as any) as DecodedContractEvent<PoolTransitionPayload>
    const repaidEvent = parseContractEvent(goldenEvents[2] as any) as DecodedContractEvent<PoolTransitionPayload>

    const processedIds = new Set<string>()

    const { state: state1 } = reducePoolEvent(null, createdEvent, processedIds)
    expect(state1.id).toBe(1)
    expect(state1.active).toBe(true)

    const { state: state2 } = reducePoolEvent(state1, fundedEvent, processedIds)
    expect(state2.totalInvested).toBe("500000")
    expect(state2.investorPositions["GINVESTOR1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ"].invested).toBe("500000")

    const { state: state3 } = reducePoolEvent(state2, repaidEvent, processedIds)
    expect(state3.totalRepaid).toBe("200000")

    // Test duplicate event delivery
    const { state: stateDuplicate, isDuplicate } = reducePoolEvent(state3, fundedEvent, processedIds)
    expect(isDuplicate).toBe(true)
    expect(stateDuplicate.totalInvested).toBe("500000") // unchanged
  })

  it("idempotently reduces repayment driver events", () => {
    const assignedEvent = parseContractEvent(goldenEvents[3] as any) as DecodedContractEvent<RepaymentTransitionPayload>
    const recordedEvent = parseContractEvent(goldenEvents[4] as any) as DecodedContractEvent<RepaymentTransitionPayload>

    const processedIds = new Set<string>()

    const { state: state1 } = reduceRepaymentEvent(null, assignedEvent, processedIds)
    expect(state1.totalOwed).toBe("1500000")
    expect(state1.totalRepaid).toBe("0")

    const { state: state2 } = reduceRepaymentEvent(state1, recordedEvent, processedIds)
    expect(state2.totalRepaid).toBe("300000")

    // Test duplicate delivery
    const { isDuplicate } = reduceRepaymentEvent(state2, recordedEvent, processedIds)
    expect(isDuplicate).toBe(true)
  })
})

describe("Genesis Rebuild Equivalence & Comparison", () => {
  it("rebuilds projections from genesis event log and matches incremental projections", () => {
    const events = goldenEvents.map((raw) => parseContractEvent(raw as any))

    // Genesis rebuild from raw event stream
    const rebuild = rebuildProjectionsFromEvents(events)

    expect(rebuild.totalEventsProcessed).toBe(5)
    expect(rebuild.duplicatesSkipped).toBe(0)
    expect(rebuild.poolProjections[1]).toBeDefined()
    expect(rebuild.poolProjections[1].totalInvested).toBe("500000")
    expect(rebuild.poolProjections[1].totalRepaid).toBe("200000")
    expect(rebuild.driverProjections["GDRIVER1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ"].totalRepaid).toBe("300000")

    // Compare with identical incremental state
    const comparison = compareProjections(rebuild, {
      pools: rebuild.poolProjections,
      drivers: rebuild.driverProjections,
    })

    expect(comparison.isEquivalent).toBe(true)
    expect(comparison.mismatches).toHaveLength(0)
  })

  it("detects duplicates and handles out-of-order event streams during rebuild", () => {
    const events = goldenEvents.map((raw) => parseContractEvent(raw as any))
    // Duplicate one event
    const duplicatedEvents = [...events, events[1]]

    const rebuild = rebuildProjectionsFromEvents(duplicatedEvents)

    expect(rebuild.totalEventsProcessed).toBe(6)
    expect(rebuild.duplicatesSkipped).toBe(1)
    expect(rebuild.poolProjections[1].totalInvested).toBe("500000") // not doubled
  })
})
