import mongoose, { Document, Schema } from "mongoose"

export type PoolInvestmentStatus = "PENDING" | "CONFIRMED" | "FAILED"

export interface IPoolInvestment extends Document {
  poolId: Schema.Types.ObjectId
  userId: Schema.Types.ObjectId
  amountNgn: number
  ownershipUnits: number
  ownershipBps: number
  txRef: string
  status: PoolInvestmentStatus
  createdAt: Date
  updatedAt: Date
}

const PoolInvestmentSchema: Schema = new Schema(
  {
    poolId: {
      type: Schema.Types.ObjectId,
      ref: "InvestmentPool",
      required: true,
      index: true,
    },
    userId: {
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
    ownershipUnits: {
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
    txRef: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["PENDING", "CONFIRMED", "FAILED"],
      default: "CONFIRMED",
      index: true,
    },
  },
  { timestamps: true },
)

PoolInvestmentSchema.index({ poolId: 1, userId: 1, createdAt: -1 })

export default (mongoose.models.PoolInvestment ||
  mongoose.model<IPoolInvestment>("PoolInvestment", PoolInvestmentSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;