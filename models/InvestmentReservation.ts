import mongoose, { Document, Schema } from "mongoose"

/**
 * A durable command record for a pool investment.  It is deliberately kept
 * separate from PoolInvestment: this document owns the temporary hold while
 * PoolInvestment represents only a settled position.
 */
export type InvestmentReservationStatus = "PENDING" | "RESERVED" | "SETTLED" | "EXPIRED" | "CANCELLED" | "FAILED"

export interface IInvestmentReservation extends Document {
  poolId: Schema.Types.ObjectId
  userId: Schema.Types.ObjectId
  idempotencyKey: string
  amountNgn: number
  status: InvestmentReservationStatus
  expiresAt: Date
  poolInvestmentId?: Schema.Types.ObjectId
  failureReason?: string
  createdAt: Date
  updatedAt: Date
}

const InvestmentReservationSchema = new Schema(
  {
    poolId: { type: Schema.Types.ObjectId, ref: "InvestmentPool", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    idempotencyKey: { type: String, required: true, trim: true, maxlength: 128, immutable: true },
    amountNgn: { type: Number, required: true, min: 0 },
    status: {
      type: String,
      enum: ["PENDING", "RESERVED", "SETTLED", "EXPIRED", "CANCELLED", "FAILED"],
      default: "PENDING",
      index: true,
    },
    expiresAt: { type: Date, required: true, index: true },
    poolInvestmentId: { type: Schema.Types.ObjectId, ref: "PoolInvestment", index: true, sparse: true },
    failureReason: { type: String, trim: true, maxlength: 200 },
  },
  { timestamps: true },
)

// The user scope prevents one investor's client token from affecting another.
InvestmentReservationSchema.index({ userId: 1, idempotencyKey: 1 }, { unique: true })
InvestmentReservationSchema.index({ status: 1, expiresAt: 1 })

export default (mongoose.models.InvestmentReservation ||
  mongoose.model<IInvestmentReservation>("InvestmentReservation", InvestmentReservationSchema)) as mongoose.Model<{
  _id: any
  [key: string]: any
}>
