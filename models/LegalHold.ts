import mongoose from "mongoose"

/**
 * Resource-level legal / operational holds. A hold prevents deletion,
 * anonymization, and (in the EXPORT flow) removal of personal fields for the
 * scope of resources it covers. Holds are visible to authorized admins and
 * are evaluated for every privacy deletion request.
 */
export type LegalHoldScope =
  | "user"
  | "kyc_document"
  | "wallet"
  | "contract"
  | "investment"
  | "transaction"
  | "loan"
  | "vehicle"
  | "audit_record"

export type LegalHoldReason =
  | "litigation"
  | "regulatory_investigation"
  | "tax_audit"
  | "law_enforcement_request"
  | "aml_review"
  | "internal_fraud_investigation"
  | "compliance_hold"
  | "operational"

export type LegalHoldStatus = "ACTIVE" | "RELEASED" | "EXPIRED"

export interface ILegalHoldHistoryEvent {
  event: "created" | "extended" | "released" | "expired"
  actor: string
  actorType: "admin" | "system"
  reason?: string
  metadata?: Record<string, unknown>
  at: Date
}

export interface ILegalHold {
  _id: any
  id: string
  /** Optional user-level hold (covers every resource owned by the user). */
  userId?: string
  /** Optional resource-level hold. */
  resourceType?: LegalHoldScope
  resourceId?: string
  /** Free-form scope description (e.g. "all transactions", "kyc_documents"). */
  description?: string
  reason: LegalHoldReason
  /** Free-form reason text shown to authorized admins. */
  reasonText?: string
  status: LegalHoldStatus
  /** Authoritative actor who created the hold. */
  createdBy: string
  createdByRole: "admin" | "system"
  /** Optional hard expiry. NULL means "indefinite" (until released). */
  expiresAt?: Date
  releasedAt?: Date
  releasedBy?: string
  releaseReason?: string
  /** Snapshot of case/ticket reference for traceability. */
  reference?: string
  history: ILegalHoldHistoryEvent[]
  createdAt: Date
  updatedAt: Date
}

const LegalHoldHistoryEventSchema = new mongoose.Schema<ILegalHoldHistoryEvent>(
  {
    event: {
      type: String,
      enum: ["created", "extended", "released", "expired"],
      required: true,
    },
    actor: { type: String, required: true, trim: true },
    actorType: { type: String, enum: ["admin", "system"], required: true },
    reason: { type: String, trim: true, maxlength: 1000 },
    metadata: { type: mongoose.Schema.Types.Mixed },
    at: { type: Date, default: Date.now },
  },
  { _id: false },
)

const LegalHoldSchema = new mongoose.Schema<ILegalHold>(
  {
    id: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    userId: { type: String, trim: true, index: true },
    resourceType: {
      type: String,
      enum: [
        "user",
        "kyc_document",
        "wallet",
        "contract",
        "investment",
        "transaction",
        "loan",
        "vehicle",
        "audit_record",
      ],
      index: true,
    },
    resourceId: { type: String, trim: true, index: true },
    description: { type: String, trim: true, maxlength: 500 },
    reason: {
      type: String,
      enum: [
        "litigation",
        "regulatory_investigation",
        "tax_audit",
        "law_enforcement_request",
        "aml_review",
        "internal_fraud_investigation",
        "compliance_hold",
        "operational",
      ],
      required: true,
    },
    reasonText: { type: String, trim: true, maxlength: 1000 },
    status: {
      type: String,
      enum: ["ACTIVE", "RELEASED", "EXPIRED"],
      required: true,
      default: "ACTIVE",
      index: true,
    },
    createdBy: { type: String, required: true, trim: true },
    createdByRole: { type: String, enum: ["admin", "system"], required: true },
    expiresAt: { type: Date, index: true },
    releasedAt: { type: Date },
    releasedBy: { type: String, trim: true },
    releaseReason: { type: String, trim: true, maxlength: 1000 },
    reference: { type: String, trim: true, maxlength: 200 },
    history: { type: [LegalHoldHistoryEventSchema], default: [] },
  },
  { timestamps: true },
)

LegalHoldSchema.index({ status: 1, userId: 1 })
LegalHoldSchema.index({ status: 1, resourceType: 1, resourceId: 1 })
LegalHoldSchema.index({ status: 1, expiresAt: 1 })

export default (mongoose.models.LegalHold ||
  mongoose.model<ILegalHold>("LegalHold", LegalHoldSchema)) as mongoose.Model<ILegalHold>
