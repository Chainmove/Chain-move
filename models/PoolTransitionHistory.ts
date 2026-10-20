import mongoose, { Document, Schema } from "mongoose"
import type { PoolStatus } from "./InvestmentPool"

export interface IPoolTransitionHistory extends Document {
  poolId: Schema.Types.ObjectId
  fromStatus: PoolStatus
  toStatus: PoolStatus
  actorId: Schema.Types.ObjectId | null
  actorRole: string | null
  reason: string | null
  correlationId: string
  createdAt: Date
}

const PoolTransitionHistorySchema = new Schema<IPoolTransitionHistory>(
  {
    poolId: {
      type: Schema.Types.ObjectId,
      ref: "InvestmentPool",
      required: true,
      index: true,
    },
    fromStatus: {
      type: String,
      required: true,
    },
    toStatus: {
      type: String,
      required: true,
    },
    actorId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
    actorRole: {
      type: String,
      default: null,
    },
    reason: {
      type: String,
      default: null,
      maxlength: 500,
    },
    correlationId: {
      type: String,
      required: true,
      default: () => new mongoose.Types.ObjectId().toHexString(),
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
)

export default (mongoose.models.PoolTransitionHistory ||
  mongoose.model<IPoolTransitionHistory>(
    "PoolTransitionHistory",
    PoolTransitionHistorySchema,
  )) as mongoose.Model<IPoolTransitionHistory>
