import mongoose from "mongoose"

export type RecoveryState =
  | "requested"
  | "challenged"
  | "cooling_off"
  | "approved"
  | "executed"
  | "cancelled"
  | "disputed"

export type RecoveryNetwork = "stellar" | "evm" | "embedded"

export type FactorType = "session" | "contact_channel" | "guardian_key" | "high_risk_review"

export interface IRecoveryFactor {
  type: FactorType
  verified: boolean
  verifiedAt?: Date
  evidence?: string
}

export interface IRecoveryAuditEntry {
  fromState: RecoveryState | null
  toState: RecoveryState
  actor: string
  actorType: "user" | "guardian" | "admin" | "system"
  reason?: string
  redactedEvidence?: boolean
  timestamp: Date
}

export interface IWalletRecovery {
  _id: any
  userId: string
  network: RecoveryNetwork
  oldWalletAddress: string
  newWalletAddress: string
  reason: string
  nonce: string
  expiresAt: Date
  state: RecoveryState
  factors: IRecoveryFactor[]
  coolingOffEndsAt?: Date
  executedAt?: Date
  cancelledAt?: Date
  cancelledBy?: string
  disputedAt?: Date
  disputeReason?: string
  highRiskReviewerId?: string
  highRiskReviewNote?: string
  frozenAt?: Date
  unfrozenAt?: Date
  notificationsSentAt?: Date
  auditLog: IRecoveryAuditEntry[]
  createdAt: Date
  updatedAt: Date
}

const RecoveryFactorSchema = new mongoose.Schema<IRecoveryFactor>(
  {
    type: { type: String, enum: ["session", "contact_channel", "guardian_key", "high_risk_review"], required: true },
    verified: { type: Boolean, default: false },
    verifiedAt: { type: Date },
    evidence: { type: String },
  },
  { _id: false },
)

const AuditEntrySchema = new mongoose.Schema<IRecoveryAuditEntry>(
  {
    fromState: { type: String, default: null },
    toState: { type: String, required: true },
    actor: { type: String, required: true },
    actorType: { type: String, enum: ["user", "guardian", "admin", "system"], required: true },
    reason: { type: String },
    redactedEvidence: { type: Boolean, default: false },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
)

const WalletRecoverySchema = new mongoose.Schema<IWalletRecovery>(
  {
    userId: { type: String, required: true, index: true },
    network: { type: String, enum: ["stellar", "evm", "embedded"], required: true },
    oldWalletAddress: { type: String, required: true },
    newWalletAddress: { type: String, required: true },
    reason: { type: String, required: true, maxlength: 1000 },
    nonce: { type: String, required: true, unique: true },
    expiresAt: { type: Date, required: true },
    state: {
      type: String,
      enum: ["requested", "challenged", "cooling_off", "approved", "executed", "cancelled", "disputed"],
      default: "requested",
      index: true,
    },
    factors: [RecoveryFactorSchema],
    coolingOffEndsAt: { type: Date },
    executedAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledBy: { type: String },
    disputedAt: { type: Date },
    disputeReason: { type: String },
    highRiskReviewerId: { type: String },
    highRiskReviewNote: { type: String },
    frozenAt: { type: Date },
    unfrozenAt: { type: Date },
    notificationsSentAt: { type: Date },
    auditLog: [AuditEntrySchema],
  },
  { timestamps: true },
)

WalletRecoverySchema.index({ userId: 1, state: 1 })
WalletRecoverySchema.index({ oldWalletAddress: 1 })
WalletRecoverySchema.index({ newWalletAddress: 1 })
WalletRecoverySchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 })

export default (mongoose.models.WalletRecovery as mongoose.Model<IWalletRecovery>) ||
  mongoose.model<IWalletRecovery>("WalletRecovery", WalletRecoverySchema)
