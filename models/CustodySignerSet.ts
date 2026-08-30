import mongoose, { Document, Schema } from "mongoose"
import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"

export type CustodyOperationCategory = "issuance" | "payout" | "emergency" | "recovery" | "rotation"
export type CustodySignerRole = "issuer" | "distribution" | "security" | "recovery"
export type CustodySignerSetStatus = "pending" | "active" | "retiring" | "retired" | "rolled_back"
export type CustodyQuorumType = "standard" | "recovery"

export interface ICustodySignerSet extends Document {
  category: CustodyOperationCategory
  network: string
  version: number
  previousVersion?: number
  status: CustodySignerSetStatus
  signers: Array<{
    signerId: string
    role: CustodySignerRole
    publicKey: string
    weight: number
  }>
  threshold: number
  overlapWindowMs: number
  effectiveFrom?: Date
  effectiveTo?: Date
  payoutPolicy?: {
    allowedDestinations: string[]
    maxAmount?: string
    dailyLimit?: string
  }
  rotationApprovals: Array<{
    approvedBy: string
    role: CustodySignerRole
    quorumType: CustodyQuorumType
    approvedAt: Date
  }>
  createdBy?: string
  requestId?: string
  createdAt: Date
  updatedAt: Date
}

const TERMINAL_STATUSES: CustodySignerSetStatus[] = ["retired", "rolled_back"]

const CustodySignerSetSchema: Schema = new Schema(
  {
    category: {
      type: String,
      enum: ["issuance", "payout", "emergency", "recovery", "rotation"],
      required: true,
    },
    network: { type: String, required: true, trim: true, lowercase: true },
    version: { type: Number, required: true, min: 1 },
    previousVersion: { type: Number, min: 1 },
    status: {
      type: String,
      enum: ["pending", "active", "retiring", "retired", "rolled_back"],
      default: "pending",
    },
    signers: {
      type: [
        {
          signerId: { type: String, required: true, trim: true },
          role: { type: String, enum: ["issuer", "distribution", "security", "recovery"], required: true },
          publicKey: {
            type: String,
            required: true,
            trim: true,
            validate: {
              validator: (value: string) => isValidStellarPublicKey(normalizeStellarPublicKey(value)),
              message: "Invalid signer public key",
            },
          },
          weight: { type: Number, required: true, min: 1 },
        },
      ],
      required: true,
      validate: {
        validator: (value: unknown[]) => Array.isArray(value) && value.length > 0,
        message: "Signer set must include at least one signer",
      },
    },
    threshold: { type: Number, required: true, min: 1 },
    overlapWindowMs: { type: Number, required: true, default: 24 * 60 * 60 * 1000 },
    effectiveFrom: { type: Date },
    effectiveTo: { type: Date },
    payoutPolicy: {
      type: {
        allowedDestinations: {
          type: [
            {
              type: String,
              validate: {
                validator: (value: string) => isValidStellarPublicKey(normalizeStellarPublicKey(value)),
                message: "Invalid payout allowlist destination",
              },
            },
          ],
          required: true,
        },
        maxAmount: { type: String },
        dailyLimit: { type: String },
      },
      default: undefined,
    },
    rotationApprovals: {
      type: [
        {
          approvedBy: { type: String, required: true },
          role: { type: String, enum: ["issuer", "distribution", "security", "recovery"], required: true },
          quorumType: { type: String, enum: ["standard", "recovery"], required: true },
          approvedAt: { type: Date, required: true },
        },
      ],
      default: [],
    },
    createdBy: { type: String },
    requestId: { type: String },
  },
  { timestamps: true },
)

CustodySignerSetSchema.index({ category: 1, network: 1, version: 1 }, { unique: true })
CustodySignerSetSchema.index({ category: 1, network: 1, status: 1 })

// Retired and rolled-back signer sets are terminal and immutable, mirroring
// the append-only conventions used for TamperEvidentAuditLog and the
// active-identity immutability rule on StellarPoolAsset. Rotation must
// always create a new version rather than edit a terminal document.
CustodySignerSetSchema.pre<ICustodySignerSet>("save", async function (next) {
  if (this.isNew) {
    next()
    return
  }
  const existing = (await mongoose.models.CustodySignerSet.findById(this._id).select("status").lean()) as any
  if (existing && TERMINAL_STATUSES.includes(existing.status)) {
    next(new Error("CUSTODY_SIGNER_SET_TERMINAL: retired/rolled_back signer sets are immutable"))
    return
  }
  next()
})

for (const hook of ["findOneAndUpdate", "updateOne", "updateMany"] as const) {
  CustodySignerSetSchema.pre(hook, async function (this: any, next) {
    const existing = (await this.model.findOne(this.getQuery()).select("status").lean()) as any
    if (existing && TERMINAL_STATUSES.includes(existing.status)) {
      next(new Error("CUSTODY_SIGNER_SET_TERMINAL: retired/rolled_back signer sets are immutable"))
      return
    }
    next()
  })
}

export default mongoose.models.CustodySignerSet ||
  mongoose.model<ICustodySignerSet>("CustodySignerSet", CustodySignerSetSchema)
