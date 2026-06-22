import mongoose, { Document, Schema } from "mongoose"

/**
 * Persists the last successfully processed Stellar cursor (paging token)
 * for a named indexer stream. The indexer reads this value on startup so
 * it can resume from the correct ledger position instead of replaying the
 * full history on every run.
 */
export interface IStellarIndexerCursor {
  /** Stable identifier for the indexer stream, e.g. "payments", "operations". */
  streamId: string
  /** Stellar Horizon paging token / cursor value for the last processed record. */
  cursor: string
  updatedAt: Date
  createdAt: Date
}

const StellarIndexerCursorSchema = new Schema<IStellarIndexerCursor>(
  {
    streamId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    cursor: {
      type: String,
      required: true,
      trim: true,
    },
  },
  { timestamps: true },
)

export default (mongoose.models.StellarIndexerCursor ||
  mongoose.model<IStellarIndexerCursor>("StellarIndexerCursor", StellarIndexerCursorSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;