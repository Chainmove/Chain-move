import mongoose, { Document, Schema } from "mongoose"

export type DiscrepancyCategory =
  | "MISSING_INTERNAL_RECORD"
  | "MISSING_PROVIDER_RECORD"
  | "DUPLICATE_PROVIDER_RECORD"
  | "DUPLICATE_INTERNAL_RECORD"
  | "AMOUNT_MISMATCH"
  | "OWNER_MISMATCH"
  | "STATUS_MISMATCH"
  | "STALE_PENDING"
  | "REVERSAL_REFUND"
  | "UNKNOWN_ACCOUNT"
  | "INTERNAL_LEDGER_MISMATCH"

export type RemediationStatus = "unresolved" | "auto_remediated" | "manually_resolved" | "ignored"

export interface IReconciliationDiscrepancy extends Document {
  fingerprint: string
  runId: string
  category: DiscrepancyCategory
  providerReference?: string
  providerAmount?: number
  providerCurrency?: string
  providerStatus?: string
  providerChannel?: string
  providerCustomerEmail?: string
  providerDedicatedAccount?: string
  internalTransactionId?: string
  internalPaymentId?: string
  internalAmount?: number
  internalStatus?: string
  explanation: string
  details?: Record<string, unknown>
  remediationStatus: RemediationStatus
  resolutionNotes?: string
  resolvedByUserId?: Schema.Types.ObjectId
  resolvedAt?: Date
  resolutionAction?: string
  auditLogId?: Schema.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const ReconciliationDiscrepancySchema = new Schema<IReconciliationDiscrepancy>(
  {
    fingerprint: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    runId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    category: {
      type: String,
      enum: [
        "MISSING_INTERNAL_RECORD",
        "MISSING_PROVIDER_RECORD",
        "DUPLICATE_PROVIDER_RECORD",
        "DUPLICATE_INTERNAL_RECORD",
        "AMOUNT_MISMATCH",
        "OWNER_MISMATCH",
        "STATUS_MISMATCH",
        "STALE_PENDING",
        "REVERSAL_REFUND",
        "UNKNOWN_ACCOUNT",
        "INTERNAL_LEDGER_MISMATCH",
      ],
      required: true,
      index: true,
    },
    providerReference: {
      type: String,
      trim: true,
      index: true,
    },
    providerAmount: {
      type: Number,
    },
    providerCurrency: {
      type: String,
      default: "NGN",
    },
    providerStatus: {
      type: String,
      trim: true,
    },
    providerChannel: {
      type: String,
      trim: true,
    },
    providerCustomerEmail: {
      type: String,
      trim: true,
    },
    providerDedicatedAccount: {
      type: String,
      trim: true,
    },
    internalTransactionId: {
      type: String,
      trim: true,
      index: true,
    },
    internalPaymentId: {
      type: String,
      trim: true,
    },
    internalAmount: {
      type: Number,
    },
    internalStatus: {
      type: String,
      trim: true,
    },
    explanation: {
      type: String,
      required: true,
    },
    details: {
      type: Schema.Types.Mixed,
    },
    remediationStatus: {
      type: String,
      enum: ["unresolved", "auto_remediated", "manually_resolved", "ignored"],
      default: "unresolved",
      index: true,
    },
    resolutionNotes: {
      type: String,
      trim: true,
    },
    resolvedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    resolvedAt: {
      type: Date,
    },
    resolutionAction: {
      type: String,
      trim: true,
    },
    auditLogId: {
      type: Schema.Types.ObjectId,
      ref: "AuditLog",
    },
  },
  { timestamps: true },
)

ReconciliationDiscrepancySchema.index({ category: 1, remediationStatus: 1 })

export default (mongoose.models.ReconciliationDiscrepancy ||
  mongoose.model<IReconciliationDiscrepancy>(
    "ReconciliationDiscrepancy",
    ReconciliationDiscrepancySchema,
  )) as mongoose.Model<IReconciliationDiscrepancy>
