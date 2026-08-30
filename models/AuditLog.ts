import mongoose, { Schema, type Document } from "mongoose"

export interface IAuditLog extends Document {
  actorId?: Schema.Types.ObjectId
  actorRole?: "admin" | "driver" | "investor"
  action: string
  targetType: string
  targetId?: string
  status: "success" | "failure"
  ipAddress?: string
  metadata?: Record<string, unknown>
  createdAt: Date
}

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    actorRole: {
      type: String,
      enum: ["admin", "driver", "investor"],
    },
    action: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    targetType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    targetId: {
      type: String,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["success", "failure"],
      default: "success",
      index: true,
    },
    ipAddress: {
      type: String,
      trim: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
)

export default (mongoose.models.AuditLog ||
  mongoose.model<IAuditLog>("AuditLog", AuditLogSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;