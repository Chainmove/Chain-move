import mongoose, { Document, Schema } from "mongoose"

export type CanonicalSettlementState =
  | "initiated"
  | "provider-pending"
  | "observed"
  | "provisionally_credited"
  | "confirmed"
  | "reversed"
  | "disputed"
  | "failed"
  | "expired"

export type SettlementRail = "paystack" | "stellar" | "internal_ledger" | "bank_transfer"

export interface OperatorTimelineEntry {
  fromState: CanonicalSettlementState | null
  toState: CanonicalSettlementState
  triggeredBy: "webhook" | "verifier" | "indexer" | "operator" | "system"
  reason: string
  safeActions: string[]
  metadata?: Record<string, unknown>
  timestamp: Date
}

export interface ISettlementRecord extends Document {
  settlementId: string
  rail: SettlementRail
  environment: string
  currentState: CanonicalSettlementState
  providerReference: string
  stellarHash?: string
  ledgerJournalId?: string
  poolInvestmentId?: string
  userTransactionId?: string
  driverPaymentId?: string
  userId: Schema.Types.ObjectId
  userType: "driver" | "investor" | "admin"
  paymentType: "wallet_funding" | "down_payment" | "driver_repayment" | "pool_investment" | "payout"
  amount: number
  currency: string
  finalityThreshold: number
  confirmationsCount: number
  timeline: OperatorTimelineEntry[]
  isStuck: boolean
  stuckReason?: string
  actionableAlertSent: boolean
  lastEvaluatedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const OperatorTimelineEntrySchema = new Schema<OperatorTimelineEntry>(
  {
    fromState: { type: String, default: null },
    toState: { type: String, required: true },
    triggeredBy: {
      type: String,
      enum: ["webhook", "verifier", "indexer", "operator", "system"],
      required: true,
    },
    reason: { type: String, required: true },
    safeActions: { type: [String], default: [] },
    metadata: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
)

const SettlementRecordSchema = new Schema<ISettlementRecord>(
  {
    settlementId: { type: String, required: true, unique: true, index: true },
    rail: {
      type: String,
      enum: ["paystack", "stellar", "internal_ledger", "bank_transfer"],
      required: true,
      index: true,
    },
    environment: { type: String, default: "development" },
    currentState: {
      type: String,
      enum: [
        "initiated",
        "provider-pending",
        "observed",
        "provisionally_credited",
        "confirmed",
        "reversed",
        "disputed",
        "failed",
        "expired",
      ],
      required: true,
      default: "initiated",
      index: true,
    },
    providerReference: { type: String, required: true, index: true },
    stellarHash: { type: String, index: true, sparse: true },
    ledgerJournalId: { type: String, index: true, sparse: true },
    poolInvestmentId: { type: String, index: true, sparse: true },
    userTransactionId: { type: String, index: true, sparse: true },
    driverPaymentId: { type: String, index: true, sparse: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    userType: {
      type: String,
      enum: ["driver", "investor", "admin"],
      required: true,
    },
    paymentType: {
      type: String,
      enum: ["wallet_funding", "down_payment", "driver_repayment", "pool_investment", "payout"],
      required: true,
    },
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: "NGN" },
    finalityThreshold: { type: Number, default: 1 },
    confirmationsCount: { type: Number, default: 0 },
    timeline: { type: [OperatorTimelineEntrySchema], default: [] },
    isStuck: { type: Boolean, default: false, index: true },
    stuckReason: { type: String },
    actionableAlertSent: { type: Boolean, default: false },
    lastEvaluatedAt: { type: Date },
  },
  { timestamps: true },
)

SettlementRecordSchema.index({ providerReference: 1, rail: 1 })
SettlementRecordSchema.index({ userId: 1, currentState: 1 })

export default (mongoose.models.SettlementRecord ||
  mongoose.model<ISettlementRecord>("SettlementRecord", SettlementRecordSchema)) as mongoose.Model<ISettlementRecord>
