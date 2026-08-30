import mongoose, { Document, Schema } from "mongoose"

/**
 * Records each Stellar network event that has been ingested by the indexer.
 * The `_id` field is used as the idempotency key. It includes the selected
 * Stellar network plus the Horizon operation/payment ID so testnet and mainnet
 * projections cannot collide.
 */
export type StellarEventType =
  | "payment"
  | "create_account"
  | "change_trust"
  | "manage_buy_offer"
  | "manage_sell_offer"
  | "invoke_host_function"
  | "unknown"

/** Application-level record types that a Stellar event can be mapped to. */
export type ChainMoveRecordType =
  | "repayment"
  | "investment"
  | "pool_investment"
  | "wallet_funding"
  | "payout"
  | "contract_interaction"
  | "unclassified"

export type StellarIndexedEventStatus = "active" | "quarantined"
export type StellarIndexedEventProvenance = "indexed" | "rebuilt_from_raw" | "legacy_backfill" | "legacy_quarantine"

export function normalizeStellarIndexedNetwork(network: string): string {
  return network.trim().toLowerCase()
}

export function buildStellarIndexedEventId(network: string, operationId: string): string {
  return `${normalizeStellarIndexedNetwork(network)}:${operationId}`
}

export interface IStellarIndexedEvent {
  /** Network-scoped idempotency key: `${network}:${operationId}`. */
  _id: string
  /** Immutable Stellar network provenance for this projected event. */
  network: string
  /** Original Stellar event/operation/payment ID from Horizon. */
  operationId: string
  /** Whether the projection is safe to serve from live activity queries. */
  projectionStatus: StellarIndexedEventStatus
  /** Migration provenance for legacy projected rows. */
  projectionProvenance?: StellarIndexedEventProvenance
  /** Reason a legacy or failed projection was quarantined. */
  quarantineReason?: string
  /** Stellar paging token / cursor at the time this event was indexed. */
  pagingToken: string
  /** Raw Stellar event type string from Horizon. */
  eventType: StellarEventType
  /** Source account that originated the event. */
  sourceAccount: string
  /** Asset code involved, e.g. "XLM", "USDC". */
  asset?: string
  /** Amount as a decimal string (Stellar uses string amounts). */
  amount?: string
  /** Destination account for payment-style events. */
  destinationAccount?: string
  /** ChainMove application record type this event maps to. */
  chainMoveRecordType: ChainMoveRecordType
  /** Ledger sequence number the event appeared in. */
  ledger?: number
  /** ISO-8601 timestamp of the event on the Stellar network. */
  stellarCreatedAt?: string
  /** Raw Horizon response payload for debugging and future re-processing. */
  raw: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

const StellarIndexedEventSchema = new Schema<IStellarIndexedEvent>(
  {
    _id: {
      type: String,
      required: true,
    },
    network: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    operationId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    projectionStatus: {
      type: String,
      enum: ["active", "quarantined"],
      required: true,
      default: "active",
      index: true,
    },
    projectionProvenance: {
      type: String,
      enum: ["indexed", "rebuilt_from_raw", "legacy_backfill", "legacy_quarantine"],
    },
    quarantineReason: { type: String },
    pagingToken: {
      type: String,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      enum: [
        "payment",
        "create_account",
        "change_trust",
        "manage_buy_offer",
        "manage_sell_offer",
        "invoke_host_function",
        "unknown",
      ],
      required: true,
    },
    sourceAccount: {
      type: String,
      required: true,
      index: true,
    },
    asset: { type: String },
    amount: { type: String },
    destinationAccount: { type: String, index: true, sparse: true },
    chainMoveRecordType: {
      type: String,
      enum: [
        "repayment",
        "investment",
        "pool_investment",
        "wallet_funding",
        "payout",
        "contract_interaction",
        "unclassified",
      ],
      required: true,
    },
    ledger: { type: Number },
    stellarCreatedAt: { type: String },
    raw: { type: Schema.Types.Mixed, required: true },
  },
  { _id: false, timestamps: true },
)

StellarIndexedEventSchema.index({ network: 1, operationId: 1 }, { unique: true })
StellarIndexedEventSchema.index({ network: 1, projectionStatus: 1, stellarCreatedAt: -1, createdAt: -1 })
StellarIndexedEventSchema.index({ network: 1, sourceAccount: 1, projectionStatus: 1 })
StellarIndexedEventSchema.index({ network: 1, destinationAccount: 1, projectionStatus: 1 }, { sparse: true })

export default (mongoose.models.StellarIndexedEvent ||
  mongoose.model<IStellarIndexedEvent>("StellarIndexedEvent", StellarIndexedEventSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;
