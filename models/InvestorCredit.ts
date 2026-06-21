import mongoose, { Document, Schema } from "mongoose"

export type InvestorCreditStatus = "POSTED"

export interface IInvestorCredit extends Document {
  paymentId: Schema.Types.ObjectId
  poolId: Schema.Types.ObjectId
  investorUserId: Schema.Types.ObjectId
  amountNgn: number
  ownershipBps: number
  status: InvestorCreditStatus
  createdAt: Date
  updatedAt: Date
}

const InvestorCreditSchema: Schema = new Schema(
  {
    paymentId: {
      type: Schema.Types.ObjectId,
      ref: "DriverPayment",
      required: true,
      index: true,
    },
    poolId: {
      type: Schema.Types.ObjectId,
      ref: "InvestmentPool",
      required: true,
      index: true,
    },
    investorUserId: {
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
    ownershipBps: {
      type: Number,
      required: true,
      min: 0,
      max: 10000,
    },
    status: {
      type: String,
      enum: ["POSTED"],
      default: "POSTED",
    },
  },
  { timestamps: true },
)

InvestorCreditSchema.index({ paymentId: 1, investorUserId: 1 }, { unique: true })
InvestorCreditSchema.index({ investorUserId: 1, createdAt: -1 })

export default (mongoose.models.InvestorCredit ||
  mongoose.model<IInvestorCredit>("InvestorCredit", InvestorCreditSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;