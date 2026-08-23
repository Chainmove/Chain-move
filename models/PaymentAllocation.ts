import mongoose, { Document, Schema } from "mongoose"

/**
 * PaymentAllocation – transparent per-payment breakdown record.
 *
 * One record is created per confirmed DriverPayment, recording exactly how
 * the accepted amount was split across arrears, current installment, fees,
 * principal, and excess. This makes dashboards deterministic and auditable.
 */
export interface IPaymentAllocation extends Document {
  paymentId: Schema.Types.ObjectId
  contractId: Schema.Types.ObjectId
  driverUserId: Schema.Types.ObjectId

  /** Gateway idempotency key (mirrors paystackRef on DriverPayment) */
  gatewayRef: string

  /** Total amount tendered */
  amountNgn: number
  /** Amount actually applied (≤ amountNgn) */
  acceptedAmountNgn: number
  /** Amount that could not be applied (overpayment cap) */
  excessAmountNgn: number

  /** Allocation breakdown */
  arrearsNgn: number
  currentInstallmentNgn: number
  feesNgn: number
  principalNgn: number

  /** Per-installment credits for drill-down */
  installmentCredits: Array<{
    installmentNumber: number
    creditedNgn: number
  }>

  /** Running contract balance immediately after this allocation */
  remainingBalanceAfterNgn: number
  /** Next due date (ISO) after this allocation, or null if fully paid */
  nextDueDateAfterIso: string | null

  /** If this allocation was created from a reversal, reference the reversal doc */
  reversalId?: Schema.Types.ObjectId

  createdAt: Date
  updatedAt: Date
}

const InstallmentCreditSchema = new Schema(
  {
    installmentNumber: { type: Number, required: true },
    creditedNgn: { type: Number, required: true, min: 0 },
  },
  { _id: false },
)

const PaymentAllocationSchema = new Schema<IPaymentAllocation>(
  {
    paymentId: {
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
    gatewayRef: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    amountNgn: { type: Number, required: true, min: 0 },
    acceptedAmountNgn: { type: Number, required: true, min: 0 },
    excessAmountNgn: { type: Number, required: true, min: 0 },
    arrearsNgn: { type: Number, required: true, min: 0 },
    currentInstallmentNgn: { type: Number, required: true, min: 0 },
    feesNgn: { type: Number, required: true, min: 0 },
    principalNgn: { type: Number, required: true, min: 0 },
    installmentCredits: { type: [InstallmentCreditSchema], default: [] },
    remainingBalanceAfterNgn: { type: Number, required: true, min: 0 },
    nextDueDateAfterIso: { type: String, default: null },
    reversalId: { type: Schema.Types.ObjectId, ref: "PaymentReversal" },
  },
  { timestamps: true },
)

// Unique per gateway reference ensures idempotency.
PaymentAllocationSchema.index({ gatewayRef: 1 }, { unique: true })
PaymentAllocationSchema.index({ contractId: 1, createdAt: -1 })
PaymentAllocationSchema.index({ driverUserId: 1, createdAt: -1 })

export default (mongoose.models.PaymentAllocation ||
  mongoose.model<IPaymentAllocation>("PaymentAllocation", PaymentAllocationSchema)) as mongoose.Model<{
  _id: any
  [key: string]: any
}>
