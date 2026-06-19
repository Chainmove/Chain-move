/**
 * lib/stellar/indexer.test.ts
 *
 * Tests for the Stellar event indexing service.
 *
 * All MongoDB interactions are mocked so no real database connection is
 * needed. The Horizon fetch is intercepted with vi.stubGlobal so no network
 * requests are made.
 */

import { describe, it, expect, beforeEach, vi, afterEach } from "vitest"
import {
  createStellarIndexer,
  mapEventToChainMoveRecord,
  MOCK_STELLAR_OPERATIONS,
  type RawStellarOperation,
  type StellarIndexer,
} from "./indexer"

// ---------------------------------------------------------------------------
// Shared mock state
// ---------------------------------------------------------------------------

/** In-memory cursor store that replaces StellarIndexerCursor model calls. */
let mockCursorStore: Record<string, string> = {}

/** In-memory event store that replaces StellarIndexedEvent model calls. */
let mockEventStore: Record<string, unknown> = {}

// ---------------------------------------------------------------------------
// Mock the DB models via vi.mock
// ---------------------------------------------------------------------------

vi.mock("@/models/StellarIndexerCursor", () => {
  return {
    default: {
      findById: vi.fn((id: string) => {
        return {
          lean: vi.fn(async () => {
            const cursor = mockCursorStore[id]
            return cursor ? { cursor } : null
          })
        }
      }),
      findByIdAndUpdate: vi.fn(async (_id: string, update: { $set?: { cursor?: string } }) => {
        const cursor = update.$set?.cursor
        if (cursor !== undefined) {
          mockCursorStore[_id] = cursor
        }
      }),
    },
  }
})

vi.mock("@/models/StellarIndexedEvent", () => {
  return {
    default: {
      create: vi.fn(async (doc: { _id: string }) => {
        if (mockEventStore[doc._id]) {
          // Simulate MongoDB duplicate key error (code 11000)
          const err = new Error("E11000 duplicate key error") as Error & { code: number }
          err.code = 11000
          throw err
        }
        mockEventStore[doc._id] = doc
        return doc
      }),
    },
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockHorizonResponse(records: RawStellarOperation[]) {
  return {
    ok: true,
    status: 200,
    statusText: "OK",
    json: async () => ({ _embedded: { records } }),
  }
}

function makeFailedHorizonResponse(status = 500, statusText = "Internal Server Error") {
  return {
    ok: false,
    status,
    statusText,
    json: async () => ({}),
  }
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  mockCursorStore = {}
  mockEventStore = {}
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// ---------------------------------------------------------------------------
// Unit tests: mapEventToChainMoveRecord
// ---------------------------------------------------------------------------

describe("mapEventToChainMoveRecord", () => {
  it("maps a CMOVE payment to 'repayment'", () => {
    const op: RawStellarOperation = {
      id: "op-1",
      paging_token: "tok-1",
      type: "payment",
      source_account: "GABC",
      asset_code: "CMOVE",
      amount: "100.00",
    }
    expect(mapEventToChainMoveRecord(op)).toBe("repayment")
  })

  it("maps a native XLM payment to 'wallet_funding'", () => {
    const op: RawStellarOperation = {
      id: "op-2",
      paging_token: "tok-2",
      type: "payment",
      source_account: "GABC",
      asset_type: "native",
      amount: "50.00",
    }
    expect(mapEventToChainMoveRecord(op)).toBe("wallet_funding")
  })

  it("maps a USDC payment to 'wallet_funding'", () => {
    const op: RawStellarOperation = {
      id: "op-3",
      paging_token: "tok-3",
      type: "payment",
      source_account: "GABC",
      asset_code: "USDC",
      amount: "200.00",
    }
    expect(mapEventToChainMoveRecord(op)).toBe("wallet_funding")
  })

  it("maps create_account to 'wallet_funding'", () => {
    const op: RawStellarOperation = {
      id: "op-4",
      paging_token: "tok-4",
      type: "create_account",
      source_account: "GABC",
      starting_balance: "10.00",
    }
    expect(mapEventToChainMoveRecord(op)).toBe("wallet_funding")
  })

  it("maps invoke_host_function to 'contract_interaction'", () => {
    const op: RawStellarOperation = {
      id: "op-5",
      paging_token: "tok-5",
      type: "invoke_host_function",
      source_account: "GABC",
    }
    expect(mapEventToChainMoveRecord(op)).toBe("contract_interaction")
  })

  it("maps manage_buy_offer to 'investment'", () => {
    const op: RawStellarOperation = {
      id: "op-6",
      paging_token: "tok-6",
      type: "manage_buy_offer",
      source_account: "GABC",
    }
    expect(mapEventToChainMoveRecord(op)).toBe("investment")
  })

  it("maps unknown type to 'unclassified'", () => {
    const op: RawStellarOperation = {
      id: "op-7",
      paging_token: "tok-7",
      type: "path_payment_strict_send",
      source_account: "GABC",
    }
    expect(mapEventToChainMoveRecord(op)).toBe("unclassified")
  })
})

// ---------------------------------------------------------------------------
// Integration-style tests: StellarIndexer (mock mode)
// ---------------------------------------------------------------------------

describe("StellarIndexer — mock mode", () => {
  let indexer: StellarIndexer

  beforeEach(() => {
    indexer = createStellarIndexer({ mock: true, streamId: "test-payments" })
  })

  it("has isMock=true when mock option is set", () => {
    expect(indexer.isMock).toBe(true)
    expect(indexer.streamId).toBe("test-payments")
  })

  it("first sync: processes all mock operations from the beginning", async () => {
    const result = await indexer.sync()

    expect(result.processed).toBe(MOCK_STELLAR_OPERATIONS.length)
    expect(result.duplicates).toBe(0)
    expect(result.errors).toBe(0)
    expect(result.lastCursor).toBe(
      MOCK_STELLAR_OPERATIONS[MOCK_STELLAR_OPERATIONS.length - 1].paging_token,
    )
    // All mock ops should be in the event store
    for (const op of MOCK_STELLAR_OPERATIONS) {
      expect(mockEventStore[op.id]).toBeDefined()
    }
  })

  it("saves the last paging token as the cursor after first sync", async () => {
    await indexer.sync()

    const lastOp = MOCK_STELLAR_OPERATIONS[MOCK_STELLAR_OPERATIONS.length - 1]
    expect(mockCursorStore["test-payments"]).toBe(lastOp.paging_token)
  })

  it("repeated sync with same cursor: all events are duplicates, no new inserts", async () => {
    // First pass — index everything
    await indexer.sync()

    // Clear cursor store to force starting from the beginning again
    mockCursorStore = {}

    // Second pass — same data, should all be duplicates since mockEventStore retains them
    const secondResult = await indexer.sync()

    expect(secondResult.processed).toBe(0)
    expect(secondResult.duplicates).toBe(MOCK_STELLAR_OPERATIONS.length)
    expect(secondResult.errors).toBe(0)
  })

  it("resumes from stored cursor and only processes new events", async () => {
    // Seed the cursor to the second mock operation's paging token,
    // simulating a previous sync that indexed ops 1 and 2.
    mockCursorStore["test-payments"] = MOCK_STELLAR_OPERATIONS[1].paging_token

    const result = await indexer.sync()

    // Should only process ops 3, 4, 5
    const expectedOps = MOCK_STELLAR_OPERATIONS.slice(2)
    expect(result.processed).toBe(expectedOps.length)
    for (const op of expectedOps) {
      expect(mockEventStore[op.id]).toBeDefined()
    }
    // Should NOT have indexed ops 1 and 2 (they come before the cursor)
    expect(mockEventStore[MOCK_STELLAR_OPERATIONS[0].id]).toBeUndefined()
    expect(mockEventStore[MOCK_STELLAR_OPERATIONS[1].id]).toBeUndefined()
  })

  it("handles duplicate events safely without errors", async () => {
    // Pre-populate two events to simulate duplicates
    mockEventStore[MOCK_STELLAR_OPERATIONS[0].id] = { _id: MOCK_STELLAR_OPERATIONS[0].id }
    mockEventStore[MOCK_STELLAR_OPERATIONS[1].id] = { _id: MOCK_STELLAR_OPERATIONS[1].id }

    const result = await indexer.sync()

    expect(result.duplicates).toBe(2)
    expect(result.errors).toBe(0)
    // The remaining new ops should still be processed
    expect(result.processed).toBe(MOCK_STELLAR_OPERATIONS.length - 2)
  })

  it("maps each mock event type to the correct ChainMove record type", async () => {
    await indexer.sync()

    // mock-op-1: CMOVE payment → repayment
    const op1 = mockEventStore["mock-op-1"] as { chainMoveRecordType: string }
    expect(op1?.chainMoveRecordType).toBe("repayment")

    // mock-op-2: native XLM payment → wallet_funding
    const op2 = mockEventStore["mock-op-2"] as { chainMoveRecordType: string }
    expect(op2?.chainMoveRecordType).toBe("wallet_funding")

    // mock-op-3: create_account → wallet_funding
    const op3 = mockEventStore["mock-op-3"] as { chainMoveRecordType: string }
    expect(op3?.chainMoveRecordType).toBe("wallet_funding")

    // mock-op-4: invoke_host_function → contract_interaction
    const op4 = mockEventStore["mock-op-4"] as { chainMoveRecordType: string }
    expect(op4?.chainMoveRecordType).toBe("contract_interaction")

    // mock-op-5: USDC payment → wallet_funding
    const op5 = mockEventStore["mock-op-5"] as { chainMoveRecordType: string }
    expect(op5?.chainMoveRecordType).toBe("wallet_funding")
  })

  it("does not advance cursor when no operations are returned", async () => {
    // Seed cursor past all mock ops so nothing is returned
    const lastOp = MOCK_STELLAR_OPERATIONS[MOCK_STELLAR_OPERATIONS.length - 1]
    mockCursorStore["test-payments"] = lastOp.paging_token

    const result = await indexer.sync()

    expect(result.processed).toBe(0)
    expect(result.duplicates).toBe(0)
    expect(result.lastCursor).toBeNull()
    // Cursor should remain unchanged
    expect(mockCursorStore["test-payments"]).toBe(lastOp.paging_token)
  })
})

// ---------------------------------------------------------------------------
// Integration-style tests: StellarIndexer (live mode with mocked fetch)
// ---------------------------------------------------------------------------

describe("StellarIndexer — live mode with mocked Horizon fetch", () => {
  let indexer: StellarIndexer

  beforeEach(() => {
    indexer = createStellarIndexer({ mock: false, streamId: "live-test" })
  })

  it("fetches from Horizon and indexes returned operations", async () => {
    const liveOps: RawStellarOperation[] = [
      {
        id: "live-op-1",
        paging_token: "live-cursor-1",
        type: "payment",
        source_account: "GABC",
        asset_code: "CMOVE",
        amount: "50.00",
        from: "GABC",
        to: "GDEF",
        created_at: "2026-06-10T12:00:00Z",
      },
    ]

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeMockHorizonResponse(liveOps)))

    const result = await indexer.sync()

    expect(result.processed).toBe(1)
    expect(result.errors).toBe(0)
    expect(result.lastCursor).toBe("live-cursor-1")
    expect(mockEventStore["live-op-1"]).toBeDefined()
  })

  it("returns errors=1 and does not save cursor when Horizon request fails", async () => {
    // Seed a cursor first
    mockCursorStore["live-test"] = "prev-cursor"

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeFailedHorizonResponse(503, "Service Unavailable")))

    const result = await indexer.sync()

    expect(result.errors).toBe(1)
    expect(result.processed).toBe(0)
    // lastCursor in result should be the previously stored cursor
    expect(result.lastCursor).toBe("prev-cursor")
    // Cursor in store should be unchanged
    expect(mockCursorStore["live-test"]).toBe("prev-cursor")
  })

  it("returns errors=1 when fetch itself throws (network failure)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("Network unreachable")),
    )

    const result = await indexer.sync()

    expect(result.errors).toBe(1)
    expect(result.processed).toBe(0)
  })

  it("passes the stored cursor as the query parameter to Horizon", async () => {
    mockCursorStore["live-test"] = "cursor-abc123"

    const fetchMock = vi.fn().mockResolvedValue(makeMockHorizonResponse([]))
    vi.stubGlobal("fetch", fetchMock)

    await indexer.sync()

    const calledUrl: string = fetchMock.mock.calls[0][0]
    expect(calledUrl).toContain("cursor=cursor-abc123")
  })

  it("first live sync without cursor does not include cursor param", async () => {
    // No cursor in store
    const fetchMock = vi.fn().mockResolvedValue(makeMockHorizonResponse([]))
    vi.stubGlobal("fetch", fetchMock)

    await indexer.sync()

    const calledUrl: string = fetchMock.mock.calls[0][0]
    expect(calledUrl).not.toContain("cursor=")
  })

  it("handles duplicate live events safely", async () => {
    const op: RawStellarOperation = {
      id: "live-dup-op",
      paging_token: "live-dup-cursor",
      type: "payment",
      source_account: "GABC",
      asset_type: "native",
      amount: "10.00",
    }

    // Pre-populate the event store to simulate a duplicate
    mockEventStore["live-dup-op"] = { _id: "live-dup-op" }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeMockHorizonResponse([op])))

    const result = await indexer.sync()

    expect(result.duplicates).toBe(1)
    expect(result.processed).toBe(0)
    expect(result.errors).toBe(0)
  })
})
