import mongoose, { Schema } from "mongoose"

export interface ITreasurySnapshot {
  snapshotDate: string
  currency: string
  buckets: Record<string, number>
  availableLiquidityMinor: number
  requiredLiquidityMinor: number
  varianceMinor: number
  explanations: string[]
  sourceJournalCount: number
  sourceThrough: Date
  createdAt: Date
}

const TreasurySnapshotSchema = new Schema<ITreasurySnapshot>(
  {
    snapshotDate: { type: String, required: true },
    currency: { type: String, required: true },
    buckets: { type: Schema.Types.Mixed, required: true },
    availableLiquidityMinor: { type: Number, required: true },
    requiredLiquidityMinor: { type: Number, required: true },
    varianceMinor: { type: Number, required: true },
    explanations: { type: [String], default: [] },
    sourceJournalCount: { type: Number, required: true },
    sourceThrough: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)
TreasurySnapshotSchema.index({ snapshotDate: 1, currency: 1 }, { unique: true })
export default (mongoose.models.TreasurySnapshot || mongoose.model<ITreasurySnapshot>("TreasurySnapshot", TreasurySnapshotSchema)) as mongoose.Model<ITreasurySnapshot>
