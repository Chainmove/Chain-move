/**
 * lib/stellar/events/decoders.ts
 *
 * Decoders and parsers for versioned Soroban contract events.
 * Provides safe validation, size checks, and version compatibility gates.
 */

import {
  CURRENT_EVENT_SCHEMA_VERSION,
  DecodedContractEvent,
  PoolTransitionPayload,
  RepaymentTransitionPayload,
  ContractEventType,
} from "@/types/contract-events"

export class IncompatibleEventVersionError extends Error {
  constructor(public version: number, public maxSupported: number) {
    super(
      `Unknown or breaking event schema version ${version}. Max supported version is ${maxSupported}. Execution halted safely to prevent state corruption.`,
    )
    this.name = "IncompatibleEventVersionError"
  }
}

export class InvalidEventPayloadError extends Error {
  constructor(message: string) {
    super(`Invalid contract event payload: ${message}`)
    this.name = "InvalidEventPayloadError"
  }
}

export const MAX_EVENT_PAYLOAD_BYTES = 1024

const SUPPORTED_TOPIC_CATEGORIES = new Set(["chainmove_pool_v1", "repayment_v1"])

const SUPPORTED_POOL_EVENT_TYPES = new Set([
  "pool_created_v1",
  "pool_funded_v1",
  "pool_repaid_v1",
  "pool_refund_v1",
  "pool_closed_v1",
])

const SUPPORTED_REPAYMENT_EVENT_TYPES = new Set([
  "repayment_init_v1",
  "driver_assigned_v1",
  "repayment_recorded_v1",
])

export interface RawSorobanEventInput {
  id?: string
  contractId: string
  ledger: number
  eventIndex?: number
  transactionHash: string
  topics: string[]
  value: Record<string, any>
  timestamp?: string
}

/**
 * Decodes a raw or structured Soroban event into a DecodedContractEvent.
 */
export function parseContractEvent(raw: RawSorobanEventInput): DecodedContractEvent {
  const category = raw.topics[0]
  const eventType = raw.topics[1] as ContractEventType

  if (!category || !SUPPORTED_TOPIC_CATEGORIES.has(category)) {
    throw new InvalidEventPayloadError(`Unsupported event category: ${category}`)
  }

  const payload = raw.value ?? {}

  // Check event payload size budget
  const jsonSize = Buffer.byteLength(JSON.stringify(payload), "utf8")
  if (jsonSize > MAX_EVENT_PAYLOAD_BYTES) {
    throw new InvalidEventPayloadError(
      `Event payload size ${jsonSize} bytes exceeds maximum allowed budget of ${MAX_EVENT_PAYLOAD_BYTES} bytes`,
    )
  }

  const version = Number(payload.version ?? 1)
  if (version > CURRENT_EVENT_SCHEMA_VERSION) {
    throw new IncompatibleEventVersionError(version, CURRENT_EVENT_SCHEMA_VERSION)
  }

  const eventId = raw.id ?? `${raw.transactionHash}:${raw.ledger}:${raw.eventIndex ?? 0}`

  if (category === "chainmove_pool_v1") {
    if (!SUPPORTED_POOL_EVENT_TYPES.has(eventType)) {
      throw new InvalidEventPayloadError(`Unsupported pool event type: ${eventType}`)
    }

    const poolPayload: PoolTransitionPayload = {
      version,
      asset: String(payload.asset || ""),
      amount: String(payload.amount ?? "0"),
      pool_id: Number(payload.pool_id ?? 0),
      position_id: String(payload.position_id || ""),
      actor: String(payload.actor || payload.position_id || ""),
      reference: String(payload.reference || ""),
      post_funded_units: Number(payload.post_funded_units ?? 0),
      post_total_invested: String(payload.post_total_invested ?? payload.amount ?? "0"),
      post_total_repaid: String(payload.post_total_repaid ?? "0"),
    }

    return {
      id: eventId,
      contractId: raw.contractId,
      ledger: raw.ledger,
      eventIndex: raw.eventIndex ?? 0,
      transactionHash: raw.transactionHash,
      topicCategory: "chainmove_pool_v1",
      eventType,
      schemaVersion: version,
      timestamp: raw.timestamp,
      payload: poolPayload,
    }
  }

  if (category === "repayment_v1") {
    if (!SUPPORTED_REPAYMENT_EVENT_TYPES.has(eventType)) {
      throw new InvalidEventPayloadError(`Unsupported repayment event type: ${eventType}`)
    }

    const repaymentPayload: RepaymentTransitionPayload = {
      version,
      driver: String(payload.driver || ""),
      pool_or_vehicle: String(payload.pool_or_vehicle || ""),
      actor: String(payload.actor || payload.driver || ""),
      amount: String(payload.amount ?? "0"),
      post_total_owed: String(payload.post_total_owed ?? "0"),
      post_total_repaid: String(payload.post_total_repaid ?? payload.amount ?? "0"),
    }

    return {
      id: eventId,
      contractId: raw.contractId,
      ledger: raw.ledger,
      eventIndex: raw.eventIndex ?? 0,
      transactionHash: raw.transactionHash,
      topicCategory: "repayment_v1",
      eventType,
      schemaVersion: version,
      timestamp: raw.timestamp,
      payload: repaymentPayload,
    }
  }

  throw new InvalidEventPayloadError(`Unrecognized category ${category}`)
}
