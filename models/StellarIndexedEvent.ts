import mongoose, { Document, Schema } from "mongoose"

/**
 * Records each Stellar network event that has been ingested by the indexer.
 * The `_id` field is used as the idempotency key — it is set to the Stellar
 * event/operation/payment ID so a second attempt to insert the same event
 * hits the unique index and is safely ignored.
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

export interface IStellarIndexedEvent {
  /** Stellar event/operation/payment ID used as idempotency key. */
  _id: string
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

export default (mongoose.models.StellarIndexedEvent ||
  mongoose.model<IStellarIndexedEvent>("StellarIndexedEvent", StellarIndexedEventSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;