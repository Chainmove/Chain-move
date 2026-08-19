import mongoose, { Document, Schema } from "mongoose"

export type TransitionEntityType = "loan" | "vehicle" | "investment"
export type TransitionActorType = "driver" | "admin" | "investor" | "system"

export interface IStateTransitionHistory extends Document {
  entityType: TransitionEntityType
  entityId: Schema.Types.ObjectId
  fromState: string | null
  toState: string
  actorType: TransitionActorType
  actorId?: Schema.Types.ObjectId
  reason: string
  correlationId?: string
  metadata?: Record<string, unknown>
  timestamp: Date
}

const StateTransitionHistorySchema = new Schema<IStateTransitionHistory>(
  {
    entityType: {
      type: String,
      enum: ["loan", "vehicle", "investment"],
      required: true,
      index: true,
    },
    entityId: {
      type: Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    fromState: { type: String, default: null },
    toState: { type: String, required: true },
    actorType: {
      type: String,
      enum: ["driver", "admin", "investor", "system"],
      required: true,
    },
    actorId: { type: Schema.Types.ObjectId, ref: "User" },
    reason: { type: String, required: true, trim: true },
    correlationId: { type: String, trim: true, index: true },
    metadata: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now, index: true },
  },
  {
    versionKey: false,
    // History records are immutable once written; no updates allowed.
  },
)

StateTransitionHistorySchema.index({ entityType: 1, entityId: 1, timestamp: -1 })

export default (mongoose.models.StateTransitionHistory ||
  mongoose.model<IStateTransitionHistory>(
    "StateTransitionHistory",
    StateTransitionHistorySchema,
  )) as mongoose.Model<IStateTransitionHistory>
