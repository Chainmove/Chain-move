import mongoose, { Document, Schema } from "mongoose"

export type DriverPaymentMethod = "PAYSTACK"
export type DriverPaymentStatus = "PENDING" | "CONFIRMED" | "FAILED"

export interface IDriverPayment extends Document {
  contractId: Schema.Types.ObjectId
  driverUserId: Schema.Types.ObjectId
  amountNgn: number
  appliedAmountNgn: number
  method: DriverPaymentMethod
  paystackRef: string
  payerEmail?: string
  status: DriverPaymentStatus
  confirmedAt?: Date
  failedReason?: string
  metadata?: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

const DriverPaymentSchema: Schema = new Schema(
  {
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
    amountNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    appliedAmountNgn: {
      type: Number,
      default: 0,
      min: 0,
    },
    method: {
      type: String,
      enum: ["PAYSTACK"],
      default: "PAYSTACK",
    },
    paystackRef: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    payerEmail: {
      type: String,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    confirmedAt: {
      type: Date,
    },
    failedReason: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  { timestamps: true },
)

DriverPaymentSchema.index({ driverUserId: 1, createdAt: -1 })
DriverPaymentSchema.index({ contractId: 1, createdAt: -1 })

export default (mongoose.models.DriverPayment ||
  mongoose.model<IDriverPayment>("DriverPayment", DriverPaymentSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;