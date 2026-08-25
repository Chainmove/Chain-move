import mongoose, { Document, Schema } from "mongoose"

/**
 * PaymentReversal – compensating record created when a confirmed DriverPayment
 * must be reversed.  Original payment history is never deleted; instead a
 * reversal record is inserted and the contract's totalPaidNgn is adjusted.
 */

export type PaymentReversalReason =
  | "PROVIDER_CHARGEBACK"    // payment provider reversed the charge
  | "ADMIN_CORRECTION"       // admin corrected a mis-posted payment
  | "DUPLICATE_PAYMENT"      // same payment was processed twice
  | "TEST_PAYMENT"           // payment made in error / test mode
  | "OTHER"

export type PaymentReversalStatus =
  | "PENDING"     // reversal created, awaiting contract adjustment
  | "APPLIED"     // contract balance has been updated
  | "FAILED"      // reversal processing failed (requires manual intervention)

export interface IPaymentReversal extends Document {
  /** Original DriverPayment _id */
  originalPaymentId: Schema.Types.ObjectId
  contractId: Schema.Types.ObjectId
  driverUserId: Schema.Types.ObjectId
  /** Amount being reversed (matches originalPayment.appliedAmountNgn) */
  reversedAmountNgn: number
  reason: PaymentReversalReason
  /** Free-text note explaining the reversal */
  notes: string
  /** Admin/system user who initiated the reversal */
  initiatedBy: Schema.Types.ObjectId
  status: PaymentReversalStatus
  appliedAt?: Date
  failedReason?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

const PaymentReversalSchema = new Schema<IPaymentReversal>(
  {
    originalPaymentId: {
      type: Schema.Types.ObjectId,
      ref: "DriverPayment",
      required: true,
      index: true,
    },
    contractId: {
      type: Schema.Types.ObjectId,
      ref: "HirePurchaseContract",
      required: true,
      index: true,
    },
    driverUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    reversedAmountNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    reason: {
      type: String,
      enum: ["PROVIDER_CHARGEBACK", "ADMIN_CORRECTION", "DUPLICATE_PAYMENT", "TEST_PAYMENT", "OTHER"],
      required: true,
    },
    notes: {
      type: String,
      required: true,
      trim: true,
    },
    initiatedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "APPLIED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    appliedAt: { type: Date },
    failedReason: { type: String, trim: true },
    metadata: { type: Schema.Types.Mixed },
  },
  { timestamps: true },
)

PaymentReversalSchema.index({ contractId: 1, createdAt: -1 })
PaymentReversalSchema.index({ driverUserId: 1, createdAt: -1 })
// Enforce one-to-one: each original payment may have at most one non-failed reversal.
PaymentReversalSchema.index(
  { originalPaymentId: 1, status: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["PENDING", "APPLIED"] } },
  },
)

export default (mongoose.models.PaymentReversal ||
  mongoose.model<IPaymentReversal>("PaymentReversal", PaymentReversalSchema)) as mongoose.Model<{
  _id: any
  [key: string]: any
}>
