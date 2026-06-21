import mongoose, { Document, Schema } from "mongoose"

export type InvestorVirtualAccountProvider = "PAYSTACK"
export type InvestorVirtualAccountStatus = "PENDING" | "ACTIVE" | "FAILED" | "INACTIVE"

export interface IInvestorVirtualAccount extends Document {
  investorUserId: Schema.Types.ObjectId
  provider: InvestorVirtualAccountProvider
  status: InvestorVirtualAccountStatus
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

const InvestorVirtualAccountSchema: Schema = new Schema(
  {
    investorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
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

InvestorVirtualAccountSchema.index({ investorUserId: 1, provider: 1 }, { unique: true })
InvestorVirtualAccountSchema.index({ accountNumber: 1 }, { unique: true, sparse: true })
InvestorVirtualAccountSchema.index({ dedicatedAccountId: 1 }, { unique: true, sparse: true })
InvestorVirtualAccountSchema.index({ investorUserId: 1, status: 1, updatedAt: -1 })

export default (mongoose.models.InvestorVirtualAccount ||
  mongoose.model<IInvestorVirtualAccount>("InvestorVirtualAccount", InvestorVirtualAccountSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;