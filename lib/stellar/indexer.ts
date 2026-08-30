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

import { buildStellarIndexedEventId, normalizeStellarIndexedNetwork, type StellarEventType, type ChainMoveRecordType } from "@/models/StellarIndexedEvent"
import { getStellarConfig } from "@/lib/stellar/config"
import crypto from "crypto"

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
  rawPersisted?: number
  deadLetters?: number
  leaseAcquired?: boolean
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
  workerId?: string
  leaseMs?: number
  expectedNetwork?: string
  expectedContractId?: string
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

async function saveCursor(streamId: string, cursor: string, leaseToken?: string): Promise<void> {
  const { default: StellarIndexerCursor } = await import("@/models/StellarIndexerCursor")
  const filter: Record<string, unknown> = { _id: streamId }
  if (leaseToken) filter.leaseToken = leaseToken
  const result = await StellarIndexerCursor.findOneAndUpdate(
    filter,
    { $set: { streamId, cursor, rawCursor: cursor, projectionCursor: cursor, lastHeartbeatAt: new Date() } },
    { upsert: true, new: true },
  ).lean()
  if (!result) throw new Error("Stellar indexer lease lost while saving cursor")
}

async function acquireLease(streamId: string, workerId: string, leaseMs: number, network: string): Promise<string | null> {
  const { default: StellarIndexerCursor } = await import("@/models/StellarIndexerCursor")
  const now = new Date()
  const leaseToken = crypto.randomUUID()
  const leaseExpiresAt = new Date(now.getTime() + leaseMs)
  const doc = await StellarIndexerCursor.findOneAndUpdate(
    {
      _id: streamId,
      $or: [
        { leaseExpiresAt: { $exists: false } },
        { leaseExpiresAt: { $lte: now } },
        { leaseOwner: workerId },
      ],
    },
    {
      $set: {
        streamId,
        network,
        leaseOwner: workerId,
        leaseToken,
        leaseExpiresAt,
        lastHeartbeatAt: now,
      },
      $setOnInsert: { cursor: "" },
    },
    { upsert: true, new: true },
  ).lean()
  return doc?.leaseToken === leaseToken ? leaseToken : null
}

function parseSequence(op: RawStellarOperation): number {
  const token = String(op.paging_token || "")
  const numeric = Number(token)
  if (Number.isFinite(numeric) && numeric > 0) return numeric
  const ledger = Number(op.ledger_attr || 0)
  const eventIndex = Number((op as any).event_index ?? (op as any).operation_index ?? 0)
  if (ledger > 0) return ledger * 1_000_000 + eventIndex
  const digits = token.match(/\d+/g)?.join("")
  return digits ? Number(digits) : Math.abs(hashString(token || op.id))
}

function hashString(value: string): number {
  return crypto.createHash("sha256").update(value).digest().readUInt32BE(0)
}

function rawEventKey(op: RawStellarOperation, streamId: string, network: string) {
  const eventIndex = Number((op as any).event_index ?? (op as any).operation_index ?? 0)
  return {
    network,
    streamId,
    ledger: Number(op.ledger_attr || 0),
    transactionHash: op.transaction_hash || op.id,
    eventIndex,
  }
}

async function persistRawEnvelope(
  op: RawStellarOperation,
  streamId: string,
  network: string,
  expectedContractId?: string,
): Promise<{ inserted: boolean; duplicate: boolean; sequence: number; error?: string }> {
  const { default: StellarRawEvent } = await import("@/models/StellarRawEvent")
  const contractId = typeof op.contract_id === "string" ? op.contract_id : undefined
  if (expectedContractId && contractId && contractId !== expectedContractId) {
    return { inserted: false, duplicate: false, sequence: parseSequence(op), error: "wrong contract" }
  }
  const doc = {
    ...rawEventKey(op, streamId, network),
    sequence: parseSequence(op),
    pagingToken: op.paging_token,
    operationId: op.id,
    contractId,
    status: "received",
    raw: op as Record<string, unknown>,
  }
  try {
    await StellarRawEvent.create(doc)
    return { inserted: true, duplicate: false, sequence: doc.sequence }
  } catch (err: unknown) {
    if (typeof err === "object" && err !== null && "code" in err && (err as { code?: unknown }).code === 11000) {
      return { inserted: false, duplicate: true, sequence: doc.sequence }
    }
    return { inserted: false, duplicate: false, sequence: doc.sequence, error: err instanceof Error ? err.message : String(err) }
  }
}

// ---------------------------------------------------------------------------
// Event persistence with idempotency
// ---------------------------------------------------------------------------

interface PersistResult {
  inserted: boolean
  duplicate: boolean
  error?: string
}

async function persistEvent(op: RawStellarOperation, network: string, projectionProvenance: "indexed" | "rebuilt_from_raw" = "indexed"): Promise<PersistResult> {
  const { default: StellarIndexedEvent } = await import("@/models/StellarIndexedEvent")

  const chainMoveRecordType = mapEventToChainMoveRecord(op)
  const eventType = toEventType(op.type ?? "unknown")
  const normalizedNetwork = normalizeStellarIndexedNetwork(network)
  const operationId = op.id

  const doc = {
    _id: buildStellarIndexedEventId(normalizedNetwork, operationId),
    network: normalizedNetwork,
    operationId,
    projectionStatus: "active",
    projectionProvenance,
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

    const txHash = op.transaction_hash || op.id
    const { default: SettlementRecord } = await import("@/models/SettlementRecord")
    const { transitionSettlementState } = await import("@/lib/settlement/settlement-service")

    const matchingSettlement = await SettlementRecord.findOne({
      $or: [{ providerReference: txHash }, { stellarHash: txHash }, { providerReference: op.id }],
      rail: "stellar",
    })

    if (matchingSettlement && matchingSettlement.currentState !== "confirmed") {
      const newConfirmations = (matchingSettlement.confirmationsCount || 0) + 1
      const isConfirmed = newConfirmations >= matchingSettlement.finalityThreshold
      await transitionSettlementState({
        settlementId: matchingSettlement.settlementId,
        targetState: isConfirmed ? "confirmed" : "observed",
        triggeredBy: "indexer",
        reason: `Indexed Stellar operation ${op.id} (ledger: ${op.ledger_attr || "unknown"})`,
        stellarHash: txHash,
        confirmationsCount: newConfirmations,
      })
    }

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

async function markProjected(op: RawStellarOperation, streamId: string, network: string): Promise<void> {
  const { default: StellarRawEvent } = await import("@/models/StellarRawEvent")
  await StellarRawEvent.findOneAndUpdate(rawEventKey(op, streamId, network), {
    $set: { status: "projected", projectedAt: new Date(), lastError: undefined },
    $inc: { attempts: 1 },
  })
}

async function quarantineDeadLetter(
  op: RawStellarOperation,
  streamId: string,
  network: string,
  reason: string,
): Promise<void> {
  const { default: StellarRawEvent } = await import("@/models/StellarRawEvent")
  const { default: StellarDeadLetterEvent } = await import("@/models/StellarDeadLetterEvent")
  const key = rawEventKey(op, streamId, network)
  await StellarRawEvent.findOneAndUpdate(key, {
    $set: { status: "dead_letter", lastError: reason },
    $inc: { attempts: 1 },
  })
  await StellarDeadLetterEvent.findOneAndUpdate(
    key,
    {
      $set: {
        ...key,
        pagingToken: op.paging_token,
        operationId: op.id,
        contractId: typeof op.contract_id === "string" ? op.contract_id : undefined,
        reason,
        raw: op as Record<string, unknown>,
      },
      $inc: { attempts: 1 },
    },
    { upsert: true, new: true },
  )
}

async function findHighestContiguousCursor(streamId: string, network: string, fetchedOps: RawStellarOperation[]) {
  const { default: StellarRawEvent } = await import("@/models/StellarRawEvent")
  let cursor: string | null = null
  for (const op of fetchedOps) {
    const raw = await StellarRawEvent.findOne(rawEventKey(op, streamId, network)).lean()
    if (!raw || raw.status !== "projected") break
    cursor = op.paging_token
  }
  return cursor
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
  replayDeadLetters(limit?: number): Promise<StellarIndexerSyncResult>
  health(): Promise<StellarIndexerHealthReport>
  /** Returns the current stream ID. */
  streamId: string
  /** Whether this indexer instance is running in mock mode. */
  isMock: boolean
}

export interface StellarIndexerHealthReport {
  streamId: string
  network: string
  sourceCursor: string | null
  rawCheckpoint: string | null
  projectionCheckpoint: string | null
  leaseOwner?: string
  leaseExpiresAt?: string
  lag: {
    rawUnprojected: number
    deadLetters: number
  }
  oldestFailure?: {
    sequence: number
    operationId: string
    reason: string
    createdAt: string
  }
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
  const workerId = options.workerId ?? `${streamId}-${process.pid}`
  const leaseMs = options.leaseMs ?? 30_000
  const network = (options.expectedNetwork ?? config.network).toLowerCase()
  const expectedContractId = options.expectedContractId ?? config.contractId

  async function sync(): Promise<StellarIndexerSyncResult> {
    let processed = 0
    let duplicates = 0
    let errors = 0
    let rawPersisted = 0
    let deadLetters = 0
    let lastCursor: string | null = null

    console.info(`[StellarIndexer] sync start — stream=${streamId} mock=${isMock}`)

    const leaseToken = await acquireLease(streamId, workerId, leaseMs, network)
    if (!leaseToken) {
      console.info(`[StellarIndexer] lease busy - stream=${streamId}`)
      return { processed, duplicates, errors, lastCursor, rawPersisted, deadLetters, leaseAcquired: false }
    }

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
      return { processed: 0, duplicates: 0, errors: 1, lastCursor: cursor, rawPersisted, deadLetters, leaseAcquired: true }
    }

    // 3. Persist raw envelopes first, then project idempotently.
    for (const op of operations) {
      if ((op as any).network && String((op as any).network).toLowerCase() !== network) {
        errors++
        deadLetters++
        await quarantineDeadLetter(op, streamId, network, "wrong network")
        console.error(`[StellarIndexer] wrong network id=${op.id}`)
        continue
      }

      const rawResult = await persistRawEnvelope(op, streamId, network, expectedContractId)
      if (rawResult.inserted) rawPersisted++
      if (rawResult.error) {
        errors++
        deadLetters++
        await quarantineDeadLetter(op, streamId, network, rawResult.error)
        console.error(`[StellarIndexer] raw envelope rejected id=${op.id}: ${rawResult.error}`)
        continue
      }

      const result = await persistEvent(op, network)

      if (result.inserted) {
        processed++
        await markProjected(op, streamId, network)
        console.info(
          `[StellarIndexer] indexed id=${op.id} type=${op.type} chainMoveRecord=${mapEventToChainMoveRecord(op)}`,
        )
      } else if (result.duplicate) {
        duplicates++
        await markProjected(op, streamId, network)
        console.info(`[StellarIndexer] duplicate id=${op.id} — skipping`)
      } else {
        errors++
        deadLetters++
        await quarantineDeadLetter(op, streamId, network, result.error || "projection failed")
        console.error(`[StellarIndexer] error persisting id=${op.id}: ${result.error}`)
      }
    }

    // 4. Persist only the latest contiguous projected cursor.
    lastCursor = await findHighestContiguousCursor(streamId, network, operations)
    if (lastCursor) {
      await saveCursor(streamId, lastCursor, leaseToken)
      console.info(`[StellarIndexer] cursor saved: ${lastCursor}`)
    }

    console.info(
      `[StellarIndexer] sync complete — processed=${processed} duplicates=${duplicates} errors=${errors}`,
    )

    return { processed, duplicates, errors, lastCursor, rawPersisted, deadLetters, leaseAcquired: true }
  }

  async function replayDeadLetters(replayLimit = 25): Promise<StellarIndexerSyncResult> {
    const { default: StellarDeadLetterEvent } = await import("@/models/StellarDeadLetterEvent")
    const leaseToken = await acquireLease(streamId, workerId, leaseMs, network)
    if (!leaseToken) {
      return { processed: 0, duplicates: 0, errors: 0, lastCursor: null, rawPersisted: 0, deadLetters: 0, leaseAcquired: false }
    }

    let processed = 0
    let duplicates = 0
    let errors = 0
    const failures = await StellarDeadLetterEvent.find({ network, streamId, resolvedAt: { $exists: false } })
      .sort({ sequence: 1 })
      .limit(Math.max(1, Math.min(replayLimit, 100)))
      .lean()

    for (const failure of failures) {
      const op = failure.raw as RawStellarOperation
      const result = await persistEvent(op, network)
      await StellarDeadLetterEvent.findByIdAndUpdate(failure._id, {
        $inc: { replayCount: 1 },
        $set: { lastReplayAt: new Date() },
      })
      if (result.inserted || result.duplicate) {
        if (result.inserted) processed++
        if (result.duplicate) duplicates++
        await markProjected(op, streamId, network)
        await StellarDeadLetterEvent.findByIdAndUpdate(failure._id, { $set: { resolvedAt: new Date() } })
      } else {
        errors++
        await quarantineDeadLetter(op, streamId, network, result.error || "replay projection failed")
      }
    }

    const rawEvents = await (await import("@/models/StellarRawEvent")).default
      .find({ network, streamId, status: "projected" })
      .sort({ sequence: 1 })
      .lean()
    const contiguousOps = rawEvents.map((event: any) => event.raw as RawStellarOperation)
    const lastCursor = await findHighestContiguousCursor(streamId, network, contiguousOps)
    if (lastCursor) await saveCursor(streamId, lastCursor, leaseToken)

    return { processed, duplicates, errors, lastCursor, rawPersisted: 0, deadLetters: errors, leaseAcquired: true }
  }

  async function health(): Promise<StellarIndexerHealthReport> {
    const [{ default: StellarIndexerCursor }, { default: StellarRawEvent }, { default: StellarDeadLetterEvent }] =
      await Promise.all([
        import("@/models/StellarIndexerCursor"),
        import("@/models/StellarRawEvent"),
        import("@/models/StellarDeadLetterEvent"),
      ])
    const [cursor, rawUnprojected, deadLetters, oldestFailure] = await Promise.all([
      StellarIndexerCursor.findById(streamId).lean(),
      StellarRawEvent.countDocuments({ network, streamId, status: "received" }),
      StellarDeadLetterEvent.countDocuments({ network, streamId, resolvedAt: { $exists: false } }),
      StellarDeadLetterEvent.findOne({ network, streamId, resolvedAt: { $exists: false } }).sort({ sequence: 1 }).lean(),
    ])

    return {
      streamId,
      network,
      sourceCursor: cursor?.cursor || null,
      rawCheckpoint: cursor?.rawCursor || cursor?.cursor || null,
      projectionCheckpoint: cursor?.projectionCursor || cursor?.cursor || null,
      leaseOwner: cursor?.leaseOwner,
      leaseExpiresAt: cursor?.leaseExpiresAt?.toISOString?.(),
      lag: { rawUnprojected, deadLetters },
      oldestFailure: oldestFailure
        ? {
            sequence: oldestFailure.sequence,
            operationId: oldestFailure.operationId,
            reason: oldestFailure.reason,
            createdAt: oldestFailure.createdAt.toISOString(),
          }
        : undefined,
    }
  }

  return { sync, replayDeadLetters, health, streamId, isMock }
}



