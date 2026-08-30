import mongoose, { Schema } from "mongoose"

/**
 * Persists the last successfully processed Stellar cursor (paging token)
 * for a named indexer stream. The indexer reads this value on startup so
 * it can resume from the correct ledger position instead of replaying the
 * full history on every run.
 */
export interface IStellarIndexerCursor {
  _id: string
  /** Stable identifier for the indexer stream, e.g. "payments", "operations". */
  streamId: string
  /** Stellar Horizon paging token / cursor value for the last processed record. */
  cursor: string
  rawCursor?: string
  projectionCursor?: string
  network?: string
  leaseOwner?: string
  leaseToken?: string
  leaseExpiresAt?: Date
  lastHeartbeatAt?: Date
  lastErrorAt?: Date
  lastError?: string
  updatedAt?: Date
  createdAt?: Date
}

const StellarIndexerCursorSchema = new Schema<IStellarIndexerCursor>(
  {
    _id: {
      type: String,
      required: true,
    },
    streamId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    cursor: {
      type: String,
      default: "",
      trim: true,
    },
    rawCursor: { type: String, trim: true },
    projectionCursor: { type: String, trim: true },
    network: { type: String, trim: true, lowercase: true, index: true },
    leaseOwner: { type: String, trim: true },
    leaseToken: { type: String, trim: true },
    leaseExpiresAt: { type: Date, index: true },
    lastHeartbeatAt: { type: Date },
    lastErrorAt: { type: Date },
    lastError: { type: String },
  },
  { timestamps: true },
)

export default (mongoose.models.StellarIndexerCursor ||
  mongoose.model<IStellarIndexerCursor>("StellarIndexerCursor", StellarIndexerCursorSchema)) as mongoose.Model<IStellarIndexerCursor>
