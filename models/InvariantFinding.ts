import mongoose, { Document, Schema } from "mongoose"

export type InvariantSeverity = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW"
export type InvariantCategory =
  | "REFERENTIAL"
  | "STATUS_CONTRADICTION"
  | "FINANCIAL_MISMATCH"
  | "DUPLICATE_IDENTIFIER"
  | "SCHEMA_DEPRECATION"

export type InvariantRepairability = "AUTOMATIC" | "STRATEGY_REQUIRED" | "MANUAL_ONLY"
export type InvariantFindingStatus = "OPEN" | "ACKNOWLEDGED" | "SUPPRESSED" | "REPAIRED" | "FAILED"

export interface IResolutionEvent {
  action: "preview" | "repair" | "suppress" | "rollback"
  timestamp: Date
  actor?: string
  status: "success" | "failure"
  details?: Record<string, unknown>
  compensationPlan?: string
}

export interface IInvariantFinding extends Document {
  fingerprint: string
  ruleId: string
  severity: InvariantSeverity
  category: InvariantCategory
  primaryModel: string
  primaryId: string
  relatedModel?: string
  relatedId?: string
  explanation: string
  details?: Record<string, unknown>
  repairability: InvariantRepairability
  status: InvariantFindingStatus
  firstSeenAt: Date
  lastSeenAt: Date
  scanCount: number
  suppressionReason?: string
  suppressedBy?: string
  suppressedAt?: Date
  resolutionHistory: IResolutionEvent[]
  createdAt: Date
  updatedAt: Date
}

const ResolutionEventSchema = new Schema<IResolutionEvent>(
  {
    action: {
      type: String,
      enum: ["preview", "repair", "suppress", "rollback"],
      required: true,
    },
    timestamp: {
      type: Date,
      default: Date.now,
    },
    actor: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["success", "failure"],
      required: true,
    },
    details: {
      type: Schema.Types.Mixed,
    },
    compensationPlan: {
      type: String,
    },
  },
  { _id: false },
)

const InvariantFindingSchema: Schema = new Schema(
  {
    fingerprint: {
      type: String,
      required: true,
      unique: true,
      index: true,
      trim: true,
    },
    ruleId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    severity: {
      type: String,
      enum: ["CRITICAL", "HIGH", "MEDIUM", "LOW"],
      required: true,
      index: true,
    },
    category: {
      type: String,
      enum: [
        "REFERENTIAL",
        "STATUS_CONTRADICTION",
        "FINANCIAL_MISMATCH",
        "DUPLICATE_IDENTIFIER",
        "SCHEMA_DEPRECATION",
      ],
      required: true,
      index: true,
    },
    primaryModel: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    primaryId: {
      type: String,
      required: true,
      index: true,
      trim: true,
    },
    relatedModel: {
      type: String,
      trim: true,
    },
    relatedId: {
      type: String,
      trim: true,
    },
    explanation: {
      type: String,
      required: true,
    },
    details: {
      type: Schema.Types.Mixed,
    },
    repairability: {
      type: String,
      enum: ["AUTOMATIC", "STRATEGY_REQUIRED", "MANUAL_ONLY"],
      required: true,
    },
    status: {
      type: String,
      enum: ["OPEN", "ACKNOWLEDGED", "SUPPRESSED", "REPAIRED", "FAILED"],
      default: "OPEN",
      index: true,
    },
    firstSeenAt: {
      type: Date,
      default: Date.now,
    },
    lastSeenAt: {
      type: Date,
      default: Date.now,
    },
    scanCount: {
      type: Number,
      default: 1,
      min: 1,
    },
    suppressionReason: {
      type: String,
      trim: true,
    },
    suppressedBy: {
      type: String,
      trim: true,
    },
    suppressedAt: {
      type: Date,
    },
    resolutionHistory: {
      type: [ResolutionEventSchema],
      default: [],
    },
  },
  { timestamps: true },
)

InvariantFindingSchema.index({ primaryModel: 1, primaryId: 1 })
InvariantFindingSchema.index({ ruleId: 1, status: 1 })

export default (mongoose.models.InvariantFinding ||
  mongoose.model<IInvariantFinding>(
    "InvariantFinding",
    InvariantFindingSchema,
  )) as mongoose.Model<IInvariantFinding>

