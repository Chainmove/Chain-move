import mongoose from "mongoose"

export type PrivacyRequestType = "EXPORT" | "DELETION"
export type PrivacyRequestStatus =
  | "REQUESTED"
  | "CONFIRMATION_PENDING"
  | "COOLING_OFF"
  | "PROCESSING"
  | "COMPLETED"
  | "CANCELLED"
  | "FAILED"

export type PrivacyRequestSource = "user" | "admin" | "system"

export type PrivacyRequestAuditEventKind =
  | "created"
  | "confirmation_sent"
  | "confirmation_received"
  | "cooling_off_started"
  | "cooling_off_cancelled"
  | "processing_started"
  | "processing_resumed"
  | "processing_completed"
  | "processing_failed"
  | "cancelled"
  | "blocked_by_hold"
  | "blocked_by_active_finance"
  | "blocked_by_provider_reference"

export interface IPrivacyRequestAuditEvent {
  kind: PrivacyRequestAuditEventKind
  actor?: string
  actorType?: PrivacyRequestSource | "system"
  reason?: string
  metadata?: Record<string, unknown>
  at: Date
}

export interface IPrivacyRequestStep {
  /** Stable identifier for the processing step (e.g. "kyc_documents"). */
  stepId: string
  /** Human-readable label (e.g. "Anonymize KYC metadata"). */
  label: string
  status: "pending" | "in_progress" | "completed" | "skipped" | "failed"
  /** Number of records affected by this step (where applicable). */
  affectedCount?: number
  errorMessage?: string
  startedAt?: Date
  completedAt?: Date
}

export interface IPrivacyRequest {
  _id: any
  /** Stable application-level identifier surfaced to callers. */
  id: string
  userId: string
  requestType: PrivacyRequestType
  status: PrivacyRequestStatus
  source: PrivacyRequestSource
  /** Opaque confirmation token required to advance past confirmation. */
  confirmationToken?: string
  confirmationTokenExpiresAt?: Date
  confirmationReceivedAt?: Date
  /** When the cooling-off period starts (after confirmation). */
  coolingOffStartedAt?: Date
  coolingOffEndsAt?: Date
  /** Whether the request was cancelled before completion. */
  cancelledAt?: Date
  cancelledBy?: string
  cancellationReason?: string
  /** When the request entered PROCESSING (set when execution begins). */
  processingStartedAt?: Date
  /** When the request reached COMPLETED or FAILED. */
  completedAt?: Date
  /** Snapshot of the active holds that block deletion at the time of evaluation. */
  blockingHoldIds?: string[]
  /** Reason the request was blocked (if applicable). */
  blockReason?: string
  /** Idempotency token supplied by the client (prevents duplicate requests). */
  idempotencyKey?: string
  /** Optional archive produced by an EXPORT request. */
  archiveId?: string
  /** Whether the user re-confirmed the export after it expired. */
  archiveRegenerated?: boolean
  /** Per-step processing state for resumable jobs. */
  steps: IPrivacyRequestStep[]
  /** Audit trail of the request's lifecycle. */
  auditHistory: IPrivacyRequestAuditEvent[]
  retryCount: number
  lastError?: string
  /** Resolved retention policy version at the time of execution. */
  retentionPolicyVersion?: string
  /** Free-form note supplied at request time (e.g. reason). */
  userNote?: string
  [key: string]: any
}

const PrivacyRequestAuditEventSchema = new mongoose.Schema<IPrivacyRequestAuditEvent>(
  {
    kind: {
      type: String,
      enum: [
        "created",
        "confirmation_sent",
        "confirmation_received",
        "cooling_off_started",
        "cooling_off_cancelled",
        "processing_started",
        "processing_resumed",
        "processing_completed",
        "processing_failed",
        "cancelled",
        "blocked_by_hold",
        "blocked_by_active_finance",
        "blocked_by_provider_reference",
      ],
      required: true,
    },
    actor: { type: String, trim: true },
    actorType: { type: String, enum: ["user", "admin", "system"], default: "system" },
    reason: { type: String, trim: true, maxlength: 1000 },
    metadata: { type: mongoose.Schema.Types.Mixed },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
)

const PrivacyRequestStepSchema = new mongoose.Schema<IPrivacyRequestStep>(
  {
    stepId: { type: String, required: true, trim: true },
    label: { type: String, required: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "in_progress", "completed", "skipped", "failed"],
      default: "pending",
      required: true,
    },
    affectedCount: { type: Number, min: 0 },
    errorMessage: { type: String, trim: true, maxlength: 1000 },
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { _id: false },
)

const PrivacyRequestSchema = new mongoose.Schema<IPrivacyRequest>(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: {
      type: String,
      required: true,
      trim: true,
      index: true,
      ref: "User",
    },
    requestType: {
      type: String,
      enum: ["EXPORT", "DELETION"],
      required: true,
    },
    status: {
      type: String,
      enum: [
        "REQUESTED",
        "CONFIRMATION_PENDING",
        "COOLING_OFF",
        "PROCESSING",
        "COMPLETED",
        "CANCELLED",
        "FAILED",
      ],
      required: true,
      default: "REQUESTED",
      index: true,
    },
    source: {
      type: String,
      enum: ["user", "admin", "system"],
      default: "user",
      required: true,
    },
    confirmationToken: { type: String, trim: true },
    confirmationTokenExpiresAt: { type: Date },
    confirmationReceivedAt: { type: Date },
    coolingOffStartedAt: { type: Date },
    coolingOffEndsAt: { type: Date },
    cancelledAt: { type: Date },
    cancelledBy: { type: String, trim: true },
    cancellationReason: { type: String, trim: true, maxlength: 500 },
    processingStartedAt: { type: Date },
    completedAt: { type: Date },
    blockingHoldIds: { type: [String], default: undefined },
    blockReason: { type: String, trim: true, maxlength: 500 },
    idempotencyKey: { type: String, trim: true, sparse: true },
    archiveId: { type: String, trim: true },
    archiveRegenerated: { type: Boolean, default: false },
    steps: { type: [PrivacyRequestStepSchema], default: [] },
    auditHistory: { type: [PrivacyRequestAuditEventSchema], default: [] },
    retryCount: { type: Number, default: 0, min: 0 },
    lastError: { type: String, trim: true, maxlength: 1000 },
    retentionPolicyVersion: { type: String, trim: true },
    userNote: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
)

PrivacyRequestSchema.index({ userId: 1, status: 1 })
PrivacyRequestSchema.index({ status: 1, coolingOffEndsAt: 1 })
PrivacyRequestSchema.index({ userId: 1, requestType: 1, status: 1 })
PrivacyRequestSchema.index({ idempotencyKey: 1 }, { unique: true, partialFilterExpression: { idempotencyKey: { $type: "string" } } })

const PrivacyRequestModel = (mongoose.models.PrivacyRequest ||
  mongoose.model<IPrivacyRequest>("PrivacyRequest", PrivacyRequestSchema)) as mongoose.Model<IPrivacyRequest>

export default PrivacyRequestModel
export { PrivacyRequestModel as PrivacyRequest }
