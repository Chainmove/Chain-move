import mongoose, { Document, Schema } from "mongoose"

export type PoolAssetType = "SHUTTLE" | "KEKE"
export type PoolStatus = "OPEN" | "FUNDED" | "CLOSED"

export interface IInvestmentPool extends Document {
  assetType: PoolAssetType
  assetPriceNgn: number
  targetAmountNgn: number
  minContributionNgn: number
  status: PoolStatus
  currentRaisedNgn: number
  investorCount: number
  createdBy: Schema.Types.ObjectId
  description?: string
  createdAt: Date
  updatedAt: Date
}

const InvestmentPoolSchema: Schema = new Schema(
  {
    assetType: {
      type: String,
      enum: ["SHUTTLE", "KEKE"],
      required: true,
    },
    assetPriceNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    targetAmountNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    minContributionNgn: {
      type: Number,
      required: true,
      min: 0,
      default: 5000,
    },
    status: {
      type: String,
      enum: ["OPEN", "FUNDED", "CLOSED"],
      default: "OPEN",
      index: true,
    },
    currentRaisedNgn: {
      type: Number,
      default: 0,
      min: 0,
    },
    investorCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 600,
    },
  },
  { timestamps: true },
)

export default (mongoose.models.InvestmentPool ||
  mongoose.model<IInvestmentPool>("InvestmentPool", InvestmentPoolSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;