import mongoose, { Document, Schema } from "mongoose"

export type HirePurchaseAssetType = "SHUTTLE" | "KEKE"
export type HirePurchaseContractStatus = "ACTIVE" | "COMPLETED" | "DEFAULTED"

export interface IHirePurchaseContract extends Document {
  driverUserId: Schema.Types.ObjectId
  poolId: Schema.Types.ObjectId
  assetType: HirePurchaseAssetType
  vehicleDisplayName: string
  principalNgn: number
  depositNgn: number
  totalPayableNgn: number
  durationWeeks: number
  durationMonths?: number
  weeklyPaymentNgn: number
  startDate: Date
  status: HirePurchaseContractStatus
  totalPaidNgn: number
  nextDueDate: Date | null
  createdAt: Date
  updatedAt: Date
}

const HirePurchaseContractSchema: Schema = new Schema(
  {
    driverUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    poolId: {
      type: Schema.Types.ObjectId,
      ref: "InvestmentPool",
      required: true,
      index: true,
    },
    assetType: {
      type: String,
      enum: ["SHUTTLE", "KEKE"],
      required: true,
    },
    vehicleDisplayName: {
      type: String,
      required: true,
      trim: true,
    },
    principalNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    depositNgn: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPayableNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    durationWeeks: {
      type: Number,
      required: true,
      min: 1,
    },
    durationMonths: {
      type: Number,
      min: 1,
    },
    weeklyPaymentNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    startDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: ["ACTIVE", "COMPLETED", "DEFAULTED"],
      default: "ACTIVE",
      index: true,
    },
    totalPaidNgn: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextDueDate: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
)

HirePurchaseContractSchema.index({ driverUserId: 1, status: 1, createdAt: -1 })
HirePurchaseContractSchema.index({ poolId: 1, status: 1 })

export default (mongoose.models.HirePurchaseContract ||
  mongoose.model<IHirePurchaseContract>("HirePurchaseContract", HirePurchaseContractSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;