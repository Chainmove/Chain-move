import mongoose, { Document, Schema } from "mongoose"

// Tracks the highest source-account sequence number consumed by a
// successfully submitted custody envelope. This is a pre-submission
// liveness/staleness guard, not the authoritative replay defense - Horizon's
// own sequence-number check on the ledger is authoritative. See
// docs/custody-signer-rotation.md for the reconciliation procedure used
// when this watermark and the live account sequence disagree (stuck
// sequence / ambiguous submission).
export interface ICustodySequenceWatermark extends Document {
  sourceAccount: string
  network: string
  lastConsumedSequence: mongoose.Types.Decimal128
  createdAt: Date
  updatedAt: Date
}

const CustodySequenceWatermarkSchema: Schema = new Schema(
  {
    sourceAccount: { type: String, required: true, trim: true },
    network: { type: String, required: true, trim: true, lowercase: true },
    // Decimal128 so MongoDB's $max operator compares Stellar's int64
    // sequence numbers numerically instead of lexicographically as strings.
    lastConsumedSequence: { type: Schema.Types.Decimal128, required: true },
  },
  { timestamps: true },
)

CustodySequenceWatermarkSchema.index({ sourceAccount: 1, network: 1 }, { unique: true })

export default mongoose.models.CustodySequenceWatermark ||
  mongoose.model<ICustodySequenceWatermark>("CustodySequenceWatermark", CustodySequenceWatermarkSchema)
