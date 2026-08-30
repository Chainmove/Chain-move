import mongoose, { Document, Schema } from "mongoose"

export type CustodyApprovalStatus = "pending" | "quorum_reached" | "submitting" | "submitted" | "failed" | "expired"

export interface ICustodyApprovalRequest extends Document {
  network: string
  category: string
  operation: string
  sourceAccount: string
  sequence: string
  envelope: Record<string, unknown>
  envelopeHash: string
  operationsHash: string
  minTime: Date
  maxTime: Date
  signerSetVersion: number
  status: CustodyApprovalStatus
  approvals: Array<{ signerId: string; role: string; approvedAt: Date }>
  requestedBy?: string
  requestId?: string
  ledgerResult?: { hash: string; ledger: number; resultXdr: string; submittedAt: Date }
  failureReason?: string
  createdAt: Date
  updatedAt: Date
}

// Terminal: no further approvals, submission, or reconciliation is possible.
// "submitting" is intentionally excluded - it is a transient reconciliation
// state, not terminal (see lib/custody/service.ts reconcileSubmission).
const TERMINAL_STATUSES: CustodyApprovalStatus[] = ["submitted", "failed", "expired"]

const CustodyApprovalRequestSchema: Schema = new Schema(
  {
    network: { type: String, required: true, trim: true, lowercase: true },
    category: {
      type: String,
      enum: ["issuance", "payout", "emergency", "recovery", "rotation"],
      required: true,
    },
    operation: { type: String, required: true, trim: true },
    sourceAccount: { type: String, required: true, trim: true },
    sequence: { type: String, required: true },
    envelope: { type: Schema.Types.Mixed, required: true },
    envelopeHash: { type: String, required: true },
    operationsHash: { type: String, required: true },
    minTime: { type: Date, required: true },
    maxTime: { type: Date, required: true },
    signerSetVersion: { type: Number, required: true },
    status: {
      type: String,
      enum: ["pending", "quorum_reached", "submitting", "submitted", "failed", "expired"],
      default: "pending",
    },
    approvals: {
      type: [
        {
          signerId: { type: String, required: true },
          role: { type: String, required: true },
          approvedAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
    requestedBy: { type: String },
    requestId: { type: String },
    ledgerResult: {
      type: {
        hash: { type: String, required: true },
        ledger: { type: Number, required: true },
        resultXdr: { type: String, required: true },
        submittedAt: { type: Date, required: true },
      },
      default: undefined,
    },
    failureReason: { type: String },
  },
  { timestamps: true },
)

// Cross-network/cross-intent replay guard: the same envelope can never back
// more than one approval request on a given network.
CustodyApprovalRequestSchema.index({ network: 1, envelopeHash: 1 }, { unique: true })
// Stale/replayed-sequence guard: only one in-flight request may target a
// given source-account sequence at a time, so concurrent proposals for the
// same sequence fail fast instead of racing.
CustodyApprovalRequestSchema.index({ sourceAccount: 1, network: 1, sequence: 1 }, { unique: true })
CustodyApprovalRequestSchema.index({ status: 1, category: 1 })
CustodyApprovalRequestSchema.index({ signerSetVersion: 1, status: 1 })

for (const hook of ["findOneAndUpdate", "updateOne", "updateMany"] as const) {
  CustodyApprovalRequestSchema.pre(hook, async function (this: any, next) {
    const existing = (await this.model.findOne(this.getQuery()).select("status").lean()) as any
    if (existing && TERMINAL_STATUSES.includes(existing.status)) {
      next(new Error("CUSTODY_APPROVAL_REQUEST_TERMINAL: submitted/failed/expired requests are immutable"))
      return
    }
    next()
  })
}

export default mongoose.models.CustodyApprovalRequest ||
  mongoose.model<ICustodyApprovalRequest>("CustodyApprovalRequest", CustodyApprovalRequestSchema)
