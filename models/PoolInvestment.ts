import mongoose, { Document, Schema } from "mongoose"

export type PoolInvestmentStatus = "PENDING" | "CONFIRMED" | "FAILED"

export interface IPoolInvestment extends Document {
  poolId: Schema.Types.ObjectId
  userId: Schema.Types.ObjectId
  amountNgn: number
  ownershipUnits: number
  ownershipBps: number
  txRef: string
  reservationId?: Schema.Types.ObjectId
  consentAcceptanceId: string
  acceptedDocumentSetHash: string
  acceptedDocumentVersionIds: Schema.Types.ObjectId[]
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
    reservationId: { type: Schema.Types.ObjectId, ref: "InvestmentReservation" },
    consentAcceptanceId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    acceptedDocumentSetHash: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: /^[a-f0-9]{64}$/,
    },
    acceptedDocumentVersionIds: [{ type: Schema.Types.ObjectId, ref: "LegalDocumentVersion", required: true }],
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
PoolInvestmentSchema.index({ consentAcceptanceId: 1, userId: 1 })
PoolInvestmentSchema.index({ reservationId: 1 }, { unique: true, sparse: true })

export default (mongoose.models.PoolInvestment ||
  mongoose.model<IPoolInvestment>("PoolInvestment", PoolInvestmentSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;
