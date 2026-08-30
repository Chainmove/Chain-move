import mongoose, { Schema, type Document } from "mongoose"

/**
 * Maker-checker (four-eyes) approval requests for sensitive admin operations.
 * See docs/maker-checker-approvals.md for the full workflow.
 */
export type ApprovalOperationType =
  | "reconciliation.remediate"
  | "integrity.repair.apply"
  | "user.role_reassign"

export type ApprovalRiskLevel = "standard" | "high"

export type ApprovalStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "expired"
  | "executing"
  | "executed"
  | "execution_failed"
  | "stale"

export interface IApprovalHistoryEvent {
  event: string
  actorId?: string
  at: Date
  reason?: string
}

export interface IApprovalResultRef {
  type: string
  id: string
}

export interface IApprovalRequest extends Document {
  operationType: ApprovalOperationType
  riskLevel: ApprovalRiskLevel
  targetType: string
  targetId: string
  resourceVersion: string
  proposedCommand: Record<string, unknown>
  beforeState: Record<string, unknown>
  afterState: Record<string, unknown>
  requesterId: string
  requesterRole: string
  reason: string
  evidenceRefs: string[]
  status: ApprovalStatus
  approverId?: string
  decisionReason?: string
  decidedAt?: Date
  expiresAt: Date
  executedAt?: Date
  executionError?: string
  resultRefs: IApprovalResultRef[]
  emergencyOverride: boolean
  emergencyOverrideReason?: string
  history: IApprovalHistoryEvent[]
  createdAt: Date
  updatedAt: Date
}

const ApprovalHistoryEventSchema = new Schema<IApprovalHistoryEvent>(
  {
    event: { type: String, required: true },
    actorId: { type: String },
    at: { type: Date, required: true, default: Date.now },
    reason: { type: String },
  },
  { _id: false },
)

const ApprovalResultRefSchema = new Schema<IApprovalResultRef>(
  {
    type: { type: String, required: true },
    id: { type: String, required: true },
  },
  { _id: false },
)

const ApprovalRequestSchema = new Schema<IApprovalRequest>(
  {
    operationType: {
      type: String,
      enum: ["reconciliation.remediate", "integrity.repair.apply", "user.role_reassign"],
      required: true,
      index: true,
    },
    riskLevel: {
      type: String,
      enum: ["standard", "high"],
      required: true,
    },
    targetType: { type: String, required: true, index: true },
    targetId: { type: String, required: true, index: true },
    // Snapshot of the target document's `updatedAt` at request-creation time.
    // Compared against the live value at execution time to detect staleness.
    // This is a secondary, defense-in-depth signal — the authoritative safety
    // net is each executor's `revalidate()`, which re-checks business state.
    resourceVersion: { type: String, required: true },
    // Server-resolved action payload only. Never store raw client JSON,
    // secrets, or unnecessary PII here.
    proposedCommand: { type: Schema.Types.Mixed, required: true },
    beforeState: { type: Schema.Types.Mixed, default: {} },
    afterState: { type: Schema.Types.Mixed, default: {} },
    requesterId: { type: String, required: true, index: true },
    requesterRole: { type: String, required: true },
    reason: { type: String, required: true, trim: true },
    evidenceRefs: { type: [String], default: [] },
    status: {
      type: String,
      enum: [
        "pending",
        "approved",
        "rejected",
        "cancelled",
        "expired",
        "executing",
        "executed",
        "execution_failed",
        "stale",
      ],
      default: "pending",
      index: true,
    },
    approverId: { type: String, index: true },
    decisionReason: { type: String, trim: true },
    decidedAt: { type: Date },
    expiresAt: { type: Date, required: true, index: true },
    executedAt: { type: Date },
    executionError: { type: String },
    resultRefs: { type: [ApprovalResultRefSchema], default: [] },
    emergencyOverride: { type: Boolean, default: false },
    emergencyOverrideReason: { type: String, trim: true },
    // Append-only. Nothing in this API ever rewrites a prior entry, so the
    // array is a safe, immutable decision history for the request.
    history: { type: [ApprovalHistoryEventSchema], default: [] },
  },
  { timestamps: true },
)

ApprovalRequestSchema.index({ status: 1, operationType: 1, createdAt: -1 })
ApprovalRequestSchema.index({ requesterId: 1, status: 1 })

// At most one in-flight (pending/approved/executing) request per target.
// Prevents two approval requests for the same resource from racing each
// other through independent approve -> execute paths.
ApprovalRequestSchema.index(
  { targetType: 1, targetId: 1 },
  {
    unique: true,
    partialFilterExpression: { status: { $in: ["pending", "approved", "executing"] } },
  },
)

export default (mongoose.models.ApprovalRequest ||
  mongoose.model<IApprovalRequest>("ApprovalRequest", ApprovalRequestSchema)) as mongoose.Model<IApprovalRequest>
