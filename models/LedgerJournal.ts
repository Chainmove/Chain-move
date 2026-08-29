import mongoose, { Schema } from "mongoose"

export interface ILedgerJournal {
  _id: any
  referenceKey: string
  eventType:
    | "wallet_funding"
    | "wallet_debit"
    | "pool_investment"
    | "down_payment"
    | "repayment"
    | "refund"
    | "payout"
    | "fee"
    | "adjustment"
  description: string
  postedAt: Date
  status: "POSTED" | "REVERSED"
  isReversed: boolean
  reversalOfJournalId?: Schema.Types.ObjectId
  reversedByJournalId?: Schema.Types.ObjectId
  actorId?: Schema.Types.ObjectId
  reason?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
  [key: string]: any
}

const LedgerJournalSchema: Schema = new Schema(
  {
    referenceKey: { type: String, required: true, unique: true, index: true },
    eventType: {
      type: String,
      enum: [
        "wallet_funding",
        "wallet_debit",
        "pool_investment",
        "down_payment",
        "repayment",
        "refund",
        "payout",
        "fee",
        "adjustment",
      ],
      required: true,
    },
    description: { type: String, required: true },
    postedAt: { type: Date, default: Date.now },
    status: { type: String, enum: ["POSTED", "REVERSED"], default: "POSTED" },
    isReversed: { type: Boolean, default: false },
    reversalOfJournalId: { type: Schema.Types.ObjectId, ref: "LedgerJournal" },
    reversedByJournalId: { type: Schema.Types.ObjectId, ref: "LedgerJournal" },
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    reason: { type: String },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true }
)

// Immutability enforcement: prevent update or delete once posted
LedgerJournalSchema.pre("updateOne", function (next) {
  next(new Error("Posted journals are immutable and cannot be updated."))
})
LedgerJournalSchema.pre("findOneAndUpdate", function (next) {
  next(new Error("Posted journals are immutable and cannot be updated."))
})
LedgerJournalSchema.pre("deleteOne", function (next) {
  next(new Error("Posted journals are immutable and cannot be deleted."))
})
LedgerJournalSchema.pre("findOneAndDelete", function (next) {
  next(new Error("Posted journals are immutable and cannot be deleted."))
})

export default (mongoose.models.LedgerJournal ||
  mongoose.model<ILedgerJournal>("LedgerJournal", LedgerJournalSchema)) as mongoose.Model<ILedgerJournal>
