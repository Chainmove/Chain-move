/**
 * lib/stellar/indexer.ts
 *
 * Stellar event indexing service for ChainMove.
 *
 * Reads operation/payment records from the Stellar Horizon REST API (or a
 * mock data source in mock mode), maps each event to a ChainMove application
 * record, persists idempotency-safe records to MongoDB, and stores the last
 * processed cursor so subsequent runs resume from the correct position.
 *
 * ## Usage
 *
 * ```ts
 * import { createStellarIndexer } from "@/lib/stellar/indexer"
 *
 * const indexer = createStellarIndexer()
 * await indexer.sync()
 * ```
 *
 * Set `ENABLE_MOCK_STELLAR=true` to run the indexer without any live network
 * access. This is the default outside of the `production` NODE_ENV.
 */

import type { StellarEventType, ChainMoveRecordType } from "@/models/StellarIndexedEvent"
import { getStellarConfig } from "@/lib/stellar/config"

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** A single raw Horizon-style operation record. */
export interface RawStellarOperation {
  id: string
  paging_token: string
  type: string
  type_i?: number
  source_account: string
  /** ISO-8601 */
  created_at?: string
  transaction_hash?: string
  /** Payment-only fields */
  asset_type?: string
  asset_code?: string
  asset_issuer?: string
  amount?: string
  from?: string
  to?: string
  /** create_account */
  account?: string
  starting_balance?: string
  funder?: string
  /** Generic ledger reference */
  ledger_attr?: number
  [key: string]: unknown
}

/** The result of a single indexer sync pass. */
export interface StellarIndexerSyncResult {
  processed: number
  duplicates: number
  errors: number
  lastCursor: string | null
}

/** Options for creating an indexer instance. */
export interface StellarIndexerOptions {
  /**
   * Stream identifier used to namespace the cursor record in MongoDB.
   * Defaults to `"payments"`.
   */
  streamId?: string
  /**
   * Maximum number of operations to fetch per sync call.
   * Defaults to 50.
   */
  limit?: number
  /**
   * If true, forces mock mode regardless of the environment config.
   * If false, forces live mode. If omitted the config's `mock` flag is used.
   */
  mock?: boolean
}

// ---------------------------------------------------------------------------
// Event type mapping
// ---------------------------------------------------------------------------

const HORIZON_TYPE_TO_INTERNAL: Record<string, StellarEventType> = {
  payment: "payment",
  create_account: "create_account",
  change_trust: "change_trust",
  manage_buy_offer: "manage_buy_offer",
  manage_sell_offer: "manage_sell_offer",
  invoke_host_function: "invoke_host_function",
}

function toEventType(horizonType: string): StellarEventType {
  return HORIZON_TYPE_TO_INTERNAL[horizonType] ?? "unknown"
}

/**
 * Maps a raw Stellar operation to the ChainMove application record type most
 * relevant for dashboards. The heuristic intentionally errs on the side of
 * `unclassified` so future callers can apply richer domain logic.
 */
export function mapEventToChainMoveRecord(op: RawStellarOperation): ChainMoveRecordType {
  const type = op.type?.toLowerCase() ?? ""
  const assetCode = (op.asset_code ?? "").toUpperCase()
  const amount = parseFloat(op.amount ?? "0")

  switch (type) {
    case "payment": {
      // Repayment: CMOVE or platform asset flowing in (destination known)
      if (assetCode === "CMOVE") {
        return amount > 0 ? "repayment" : "payout"
      }
      // Large USDC/XLM inbound = likely wallet funding
      if (assetCode === "USDC" || op.asset_type === "native") {
        return "wallet_funding"
      }
      return "unclassified"
    }
    case "create_account":
      return "wallet_funding"
    case "invoke_host_function":
      return "contract_interaction"
    case "manage_buy_offer":
    case "manage_sell_offer":
      return "investment"
    default:
      return "unclassified"
  }
}

// ---------------------------------------------------------------------------
// Cursor helpers – thin wrappers that are imported lazily so tests can mock
// the DB layer without a real MongoDB connection.
// ---------------------------------------------------------------------------

async function loadCursor(streamId: string): Promise<string | null> {
  // Dynamic import keeps the DB dependency out of the module-level scope,
  // which makes unit testing without a real Mongoose connection easier.
  const { default: StellarIndexerCursor } = await import("@/models/StellarIndexerCursor")
  const doc = await StellarIndexerCursor.findById(streamId).lean()
  return doc?.cursor ?? null
}

async function saveCursor(streamId: string, cursor: string): Promise<void> {
  const { default: StellarIndexerCursor } = await import("@/models/StellarIndexerCursor")
  await StellarIndexerCursor.findByIdAndUpdate(
    streamId,
    { $set: { streamId, cursor } },
    { upsert: true, new: true },
  )
}

// ---------------------------------------------------------------------------
// Event persistence with idempotency
// ---------------------------------------------------------------------------

interface PersistResult {
  inserted: boolean
  duplicate: boolean
  error?: string
}

async function persistEvent(op: RawStellarOperation): Promise<PersistResult> {
  const { default: StellarIndexedEvent } = await import("@/models/StellarIndexedEvent")

  const chainMoveRecordType = mapEventToChainMoveRecord(op)
  const eventType = toEventType(op.type ?? "unknown")

  const doc = {
    _id: op.id,
    pagingToken: op.paging_token,
    eventType,
    sourceAccount: op.source_account,
    asset: op.asset_code ?? (op.asset_type === "native" ? "XLM" : undefined),
    amount: op.amount ?? op.starting_balance,
    destinationAccount: op.to ?? op.account,
    chainMoveRecordType,
    ledger: op.ledger_attr,
    stellarCreatedAt: op.created_at,
    raw: op as Record<string, unknown>,
  }

  try {
    await StellarIndexedEvent.create(doc)
    return { inserted: true, duplicate: false }
  } catch (err: unknown) {
    // MongoDB duplicate key error code 11000 means this event was already
    // indexed — this is expected on repeated syncs and is not an error.
    if (
      typeof err === "object" &&
      err !== null &&
      "code" in err &&
      (err as { code?: unknown }).code === 11000
    ) {
      return { inserted: false, duplicate: true }
    }
    const message = err instanceof Error ? err.message : String(err)
    return { inserted: false, duplicate: false, error: message }
  }
}

// ---------------------------------------------------------------------------
// Mock data source
// ---------------------------------------------------------------------------

/** Mock Stellar operations used when `ENABLE_MOCK_STELLAR=true`. */
export const MOCK_STELLAR_OPERATIONS: RawStellarOperation[] = [
  {
    id: "mock-op-1",
    paging_token: "mock-cursor-1",
    type: "payment",
    source_account: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000001",
    created_at: "2026-06-01T09:00:00Z",
    asset_code: "CMOVE",
    asset_type: "credit_alphanum4",
    amount: "120.00",
    from: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000001",
    to: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000002",
  },
  {
    id: "mock-op-2",
    paging_token: "mock-cursor-2",
    type: "payment",
    source_account: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000003",
    created_at: "2026-06-02T10:30:00Z",
    asset_type: "native",
    amount: "500.00",
    from: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000003",
    to: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000004",
  },
  {
    id: "mock-op-3",
    paging_token: "mock-cursor-3",
    type: "create_account",
    source_account: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000005",
    created_at: "2026-06-03T08:00:00Z",
    account: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000006",
    starting_balance: "10.00",
    funder: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000005",
  },
  {
    id: "mock-op-4",
    paging_token: "mock-cursor-4",
    type: "invoke_host_function",
    source_account: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000007",
    created_at: "2026-06-04T11:00:00Z",
  },
  {
    id: "mock-op-5",
    paging_token: "mock-cursor-5",
    type: "payment",
    source_account: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000008",
    created_at: "2026-06-05T14:00:00Z",
    asset_code: "USDC",
    asset_type: "credit_alphanum4",
    amount: "245.50",
    from: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000008",
    to: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000009",
  },
]

/**
 * Fetches operations from the mock data source.
 * Returns only operations whose paging_token comes after `afterCursor` when
 * a cursor is provided, simulating Horizon's `cursor` query parameter.
 */
function fetchMockOperations(
  afterCursor: string | null,
  limit: number,
): RawStellarOperation[] {
  let ops = MOCK_STELLAR_OPERATIONS

  if (afterCursor) {
    const idx = ops.findIndex((op) => op.paging_token === afterCursor)
    ops = idx >= 0 ? ops.slice(idx + 1) : []
  }

  return ops.slice(0, limit)
}

// ---------------------------------------------------------------------------
// Live Horizon client helper
// ---------------------------------------------------------------------------

interface HorizonOperationsResponse {
  _embedded?: {
    records?: RawStellarOperation[]
  }
}

async function fetchLiveOperations(
  horizonUrl: string,
  afterCursor: string | null,
  limit: number,
): Promise<RawStellarOperation[]> {
  const url = new URL(`${horizonUrl.replace(/\/$/, "")}/operations`)
  url.searchParams.set("limit", String(limit))
  url.searchParams.set("order", "asc")
  if (afterCursor) {
    url.searchParams.set("cursor", afterCursor)
  }

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/json" },
  })

  if (!response.ok) {
    throw new Error(
      `Horizon request failed: ${response.status} ${response.statusText} (${url.toString()})`,
    )
  }

  const data: HorizonOperationsResponse = await response.json()
  return data._embedded?.records ?? []
}

// ---------------------------------------------------------------------------
// Indexer factory
// ---------------------------------------------------------------------------

export interface StellarIndexer {
  /**
   * Performs a single sync pass:
   * 1. Loads the last cursor from MongoDB.
   * 2. Fetches new operations from Horizon (or mock).
   * 3. Persists each event idempotently.
   * 4. Saves the latest cursor.
   *
   * Safe to call repeatedly — duplicate events are detected via the unique
   * MongoDB `_id` and counted in `duplicates` rather than raising an error.
   */
  sync(): Promise<StellarIndexerSyncResult>
  /** Returns the current stream ID. */
  streamId: string
  /** Whether this indexer instance is running in mock mode. */
  isMock: boolean
}

/**
 * Creates a Stellar event indexer configured via `getStellarConfig()` and
 * the optional `options` overrides.
 *
 * @example
 * ```ts
 * const indexer = createStellarIndexer({ streamId: "payments", limit: 100 })
 * const result = await indexer.sync()
 * console.log(result)
 * ```
 */
export function createStellarIndexer(options: StellarIndexerOptions = {}): StellarIndexer {
  const config = getStellarConfig()
  const streamId = options.streamId ?? "payments"
  const limit = options.limit ?? 50
  const isMock = options.mock !== undefined ? options.mock : config.mock

  async function sync(): Promise<StellarIndexerSyncResult> {
    let processed = 0
    let duplicates = 0
    let errors = 0
    let lastCursor: string | null = null

    console.info(`[StellarIndexer] sync start — stream=${streamId} mock=${isMock}`)

    // 1. Load last cursor
    const cursor = await loadCursor(streamId)
    console.info(`[StellarIndexer] resuming from cursor=${cursor ?? "beginning"}`)

    // 2. Fetch operations
    let operations: RawStellarOperation[]
    try {
      if (isMock) {
        operations = fetchMockOperations(cursor, limit)
        console.info(`[StellarIndexer] mock fetch returned ${operations.length} operations`)
      } else {
        operations = await fetchLiveOperations(config.horizonUrl, cursor, limit)
        console.info(`[StellarIndexer] live fetch returned ${operations.length} operations`)
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[StellarIndexer] upstream fetch failed: ${message}`)
      return { processed: 0, duplicates: 0, errors: 1, lastCursor: cursor }
    }

    // 3. Persist each operation
    for (const op of operations) {
      const result = await persistEvent(op)

      if (result.inserted) {
        processed++
        lastCursor = op.paging_token
        console.info(
          `[StellarIndexer] indexed id=${op.id} type=${op.type} chainMoveRecord=${mapEventToChainMoveRecord(op)}`,
        )
      } else if (result.duplicate) {
        duplicates++
        // Advance cursor past the duplicate so we don't replay it forever.
        lastCursor = op.paging_token
        console.info(`[StellarIndexer] duplicate id=${op.id} — skipping`)
      } else {
        errors++
        console.error(`[StellarIndexer] error persisting id=${op.id}: ${result.error}`)
      }
    }

    // 4. Persist the latest cursor if anything was processed or skipped
    if (lastCursor) {
      await saveCursor(streamId, lastCursor)
      console.info(`[StellarIndexer] cursor saved: ${lastCursor}`)
    }

    console.info(
      `[StellarIndexer] sync complete — processed=${processed} duplicates=${duplicates} errors=${errors}`,
    )

    return { processed, duplicates, errors, lastCursor }
  }

  return { sync, streamId, isMock }
}
