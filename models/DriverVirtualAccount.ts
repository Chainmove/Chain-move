import mongoose, { Document, Schema } from "mongoose"

export type DriverVirtualAccountProvider = "PAYSTACK"
export type DriverVirtualAccountStatus = "PENDING" | "ACTIVE" | "FAILED" | "INACTIVE"

export interface IDriverVirtualAccount extends Document {
  driverUserId: Schema.Types.ObjectId
  contractId: Schema.Types.ObjectId
  provider: DriverVirtualAccountProvider
  status: DriverVirtualAccountStatus
  paystackCustomerCode?: string
  paystackCustomerId?: number
  dedicatedAccountId?: number
  accountNumber?: string
  accountName?: string
  bankName?: string
  providerSlug?: string
  currency?: string
  rawResponse?: Record<string, unknown>
  failureReason?: string
  createdAt: Date
  updatedAt: Date
}

const DriverVirtualAccountSchema: Schema = new Schema(
  {
    driverUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    contractId: {
      type: Schema.Types.ObjectId,
      ref: "HirePurchaseContract",
      required: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["PAYSTACK"],
      default: "PAYSTACK",
      required: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "ACTIVE", "FAILED", "INACTIVE"],
      default: "PENDING",
      index: true,
    },
    paystackCustomerCode: {
      type: String,
      trim: true,
      sparse: true,
    },
    paystackCustomerId: {
      type: Number,
      sparse: true,
    },
    dedicatedAccountId: {
      type: Number,
      sparse: true,
    },
    accountNumber: {
      type: String,
      trim: true,
      sparse: true,
    },
    accountName: {
      type: String,
      trim: true,
    },
    bankName: {
      type: String,
      trim: true,
    },
    providerSlug: {
      type: String,
      trim: true,
    },
    currency: {
      type: String,
      trim: true,
      default: "NGN",
    },
    rawResponse: {
      type: Schema.Types.Mixed,
    },
    failureReason: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
)

DriverVirtualAccountSchema.index({ driverUserId: 1, provider: 1 }, { unique: true })
DriverVirtualAccountSchema.index({ accountNumber: 1 }, { unique: true, sparse: true })
DriverVirtualAccountSchema.index({ dedicatedAccountId: 1 }, { unique: true, sparse: true })
DriverVirtualAccountSchema.index({ driverUserId: 1, status: 1, updatedAt: -1 })
DriverVirtualAccountSchema.index({ contractId: 1, status: 1, updatedAt: -1 })

export default (mongoose.models.DriverVirtualAccount ||
  mongoose.model<IDriverVirtualAccount>("DriverVirtualAccount", DriverVirtualAccountSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;