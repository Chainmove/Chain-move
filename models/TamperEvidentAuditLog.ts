import mongoose, { Schema, type Document } from "mongoose"

export interface ITamperEvidentAuditLog extends Document {
  // Event identification
  sequence: number
  eventId: string
  
  // Actor information
  actorId?: string
  actorRole?: "admin" | "driver" | "investor" | "system"
  actorIdentifier?: string // email or wallet for additional context
  
  // Action details
  action: string
  targetType: string
  targetId?: string
  
  // Result and context
  status: "success" | "failure"
  requestId?: string // correlation ID for request tracking
  
  // Sanitized metadata (no secrets, tokens, or raw PII)
  metadata?: Record<string, unknown>
  
  // Security context
  ipAddress?: string
  userAgent?: string
  
  // Temporal information
  timestamp: Date
  
  // Hash chain fields
  previousHash: string
  eventHash: string
  
  // Canonicalized event data (for verification)
  canonicalData: string
  
  // Partition information
  partition: string // e.g., "2026-07", "global", etc.
  
  // Legacy flag
  isLegacy: boolean
  
  createdAt: Date
}

const TamperEvidentAuditLogSchema = new Schema<ITamperEvidentAuditLog>(
  {
    sequence: {
      type: Number,
      required: true,
      index: true,
    },
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    actorId: {
      type: String,
      index: true,
    },
    actorRole: {
      type: String,
      enum: ["admin", "driver", "investor", "system"],
      index: true,
    },
    actorIdentifier: {
      type: String,
    },
    action: {
      type: String,
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      required: true,
      index: true,
    },
    targetId: {
      type: String,
      index: true,
    },
    status: {
      type: String,
      enum: ["success", "failure"],
      required: true,
      default: "success",
      index: true,
    },
    requestId: {
      type: String,
      index: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
    ipAddress: {
      type: String,
    },
    userAgent: {
      type: String,
    },
    timestamp: {
      type: Date,
      required: true,
      index: true,
    },
    previousHash: {
      type: String,
      required: true,
      index: true,
    },
    eventHash: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    canonicalData: {
      type: String,
      required: true,
    },
    partition: {
      type: String,
      required: true,
      index: true,
    },
    isLegacy: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
)

// Compound indexes for efficient queries
TamperEvidentAuditLogSchema.index({ partition: 1, sequence: 1 }, { unique: true })
TamperEvidentAuditLogSchema.index({ partition: 1, timestamp: 1 })
TamperEvidentAuditLogSchema.index({ action: 1, timestamp: -1 })
TamperEvidentAuditLogSchema.index({ actorId: 1, timestamp: -1 })

// Prevent updates and deletes at the application level
TamperEvidentAuditLogSchema.pre("save", function (next) {
  if (!this.isNew) {
    throw new Error("AUDIT_LOG_IMMUTABLE: Audit logs cannot be modified")
  }
  next()
})

TamperEvidentAuditLogSchema.pre("findOneAndUpdate", function (next) {
  next(new Error("AUDIT_LOG_IMMUTABLE: Audit logs cannot be modified"))
})

TamperEvidentAuditLogSchema.pre("updateOne", function (next) {
  next(new Error("AUDIT_LOG_IMMUTABLE: Audit logs cannot be modified"))
})

TamperEvidentAuditLogSchema.pre("updateMany", function (next) {
  next(new Error("AUDIT_LOG_IMMUTABLE: Audit logs cannot be modified"))
})

TamperEvidentAuditLogSchema.pre("findOneAndDelete", function (next) {
  next(new Error("AUDIT_LOG_IMMUTABLE: Audit logs cannot be deleted"))
})

TamperEvidentAuditLogSchema.pre("deleteOne", function (next) {
  next(new Error("AUDIT_LOG_IMMUTABLE: Audit logs cannot be deleted"))
})

TamperEvidentAuditLogSchema.pre("deleteMany", function (next) {
  next(new Error("AUDIT_LOG_IMMUTABLE: Audit logs cannot be deleted"))
})

export default (mongoose.models.TamperEvidentAuditLog ||
  mongoose.model<ITamperEvidentAuditLog>(
    "TamperEvidentAuditLog",
    TamperEvidentAuditLogSchema,
  )) as mongoose.Model<ITamperEvidentAuditLog>
