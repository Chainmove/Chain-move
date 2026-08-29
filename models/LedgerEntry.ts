import mongoose, { Schema } from "mongoose"

export interface ILedgerEntry {
  _id: any
  journalId: Schema.Types.ObjectId
  accountId: Schema.Types.ObjectId
  direction: "debit" | "credit"
  amount: number
  currency: string
  timestamp: Date
  [key: string]: any
}

const LedgerEntrySchema: Schema = new Schema(
  {
    journalId: { type: Schema.Types.ObjectId, ref: "LedgerJournal", required: true, index: true },
    accountId: { type: Schema.Types.ObjectId, ref: "LedgerAccount", required: true, index: true },
    direction: { type: String, enum: ["debit", "credit"], required: true },
    amount: { type: Number, required: true, min: 0.000001 },
    currency: { type: String, required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { timestamps: true }
)

LedgerEntrySchema.index({ journalId: 1, accountId: 1 })
LedgerEntrySchema.index({ accountId: 1, timestamp: -1 })

// Immutability enforcement: prevent update or delete after creation
LedgerEntrySchema.pre("updateOne", function (next) {
  next(new Error("Ledger entries are immutable and cannot be updated."))
})
LedgerEntrySchema.pre("findOneAndUpdate", function (next) {
  next(new Error("Ledger entries are immutable and cannot be updated."))
})
LedgerEntrySchema.pre("deleteOne", function (next) {
  next(new Error("Ledger entries are immutable and cannot be deleted."))
})
LedgerEntrySchema.pre("findOneAndDelete", function (next) {
  next(new Error("Ledger entries are immutable and cannot be deleted."))
})

export default (mongoose.models.LedgerEntry ||
  mongoose.model<ILedgerEntry>("LedgerEntry", LedgerEntrySchema)) as mongoose.Model<ILedgerEntry>
