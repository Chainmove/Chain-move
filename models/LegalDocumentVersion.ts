import crypto from "node:crypto"
import mongoose, { Document, Schema } from "mongoose"

export type LegalDocumentKey =
  | "risk_disclosure"
  | "fee_schedule"
  | "privacy_notice"
  | "hire_purchase_terms"
  | "investment_terms"

export type LegalDocumentStatus = "DRAFT" | "PUBLISHED" | "RETIRED"

export interface ILegalDocumentVersion extends Document {
  documentKey: LegalDocumentKey
  version: string
  locale: string
  jurisdiction: string
  title: string
  contentType: string
  canonicalBytes: string
  byteLength: number
  sha256: string
  status: LegalDocumentStatus
  effectiveFrom: Date
  effectiveTo?: Date
  materialChange: boolean
  replacesVersionId?: Schema.Types.ObjectId
  createdBy?: Schema.Types.ObjectId
  publishedAt?: Date
  createdAt: Date
  updatedAt: Date
}

function sha256Hex(value: string) {
  return crypto.createHash("sha256").update(Buffer.from(value, "utf8")).digest("hex")
}

const LegalDocumentVersionSchema = new Schema<ILegalDocumentVersion>(
  {
    documentKey: {
      type: String,
      enum: ["risk_disclosure", "fee_schedule", "privacy_notice", "hire_purchase_terms", "investment_terms"],
      required: true,
      index: true,
    },
    version: { type: String, required: true, trim: true },
    locale: { type: String, required: true, trim: true, lowercase: true, index: true },
    jurisdiction: { type: String, required: true, trim: true, uppercase: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 240 },
    contentType: { type: String, required: true, trim: true, default: "text/markdown; charset=utf-8" },
    canonicalBytes: { type: String, required: true },
    byteLength: { type: Number, required: true, min: 1 },
    sha256: { type: String, required: true, trim: true, lowercase: true, match: /^[a-f0-9]{64}$/ },
    status: { type: String, enum: ["DRAFT", "PUBLISHED", "RETIRED"], default: "DRAFT", index: true },
    effectiveFrom: { type: Date, required: true, index: true },
    effectiveTo: { type: Date },
    materialChange: { type: Boolean, default: false, index: true },
    replacesVersionId: { type: Schema.Types.ObjectId, ref: "LegalDocumentVersion" },
    createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    publishedAt: { type: Date },
  },
  { timestamps: true },
)

LegalDocumentVersionSchema.index(
  { documentKey: 1, locale: 1, jurisdiction: 1, version: 1 },
  { unique: true },
)
LegalDocumentVersionSchema.index({ documentKey: 1, jurisdiction: 1, locale: 1, status: 1, effectiveFrom: -1 })
LegalDocumentVersionSchema.index({ sha256: 1 })

LegalDocumentVersionSchema.pre("validate", function validateCanonicalDigest(next) {
  const doc = this as ILegalDocumentVersion
  const expectedHash = sha256Hex(doc.canonicalBytes || "")
  doc.byteLength = Buffer.byteLength(doc.canonicalBytes || "", "utf8")
  if (!doc.sha256) doc.sha256 = expectedHash
  if (doc.sha256 !== expectedHash) {
    return next(new Error("Document hash does not match canonical bytes."))
  }
  if (doc.status === "PUBLISHED" && !doc.publishedAt) doc.publishedAt = new Date()
  return next()
})

LegalDocumentVersionSchema.pre("save", async function blockPublishedMutation(next) {
  const doc = this as ILegalDocumentVersion
  if (doc.isNew) return next()
  const immutableFields = [
    "documentKey",
    "version",
    "locale",
    "jurisdiction",
    "contentType",
    "canonicalBytes",
    "byteLength",
    "sha256",
    "effectiveFrom",
  ]
  if (!immutableFields.some((field) => doc.isModified(field))) return next()

  const existing = await (doc.constructor as mongoose.Model<ILegalDocumentVersion>)
    .findById(doc._id)
    .select("status")
    .lean()
  if (existing?.status === "PUBLISHED") {
    return next(new Error("Published legal document versions are immutable."))
  }
  return next()
})

async function blockPublishedUpdate(this: mongoose.Query<unknown, ILegalDocumentVersion>, next: (err?: Error) => void) {
  const update = this.getUpdate() as Record<string, unknown> | undefined
  if (!update) return next()

  const immutableFields = new Set([
    "documentKey",
    "version",
    "locale",
    "jurisdiction",
    "contentType",
    "canonicalBytes",
    "byteLength",
    "sha256",
    "effectiveFrom",
  ])
  const directKeys = Object.keys(update)
  const setKeys = Object.keys((update.$set as Record<string, unknown> | undefined) || {})
  if (![...directKeys, ...setKeys].some((key) => immutableFields.has(key))) return next()

  const existing = await (this.model as mongoose.Model<ILegalDocumentVersion>)
    .findOne(this.getQuery())
    .select("status")
    .lean()
  if (existing?.status === "PUBLISHED") {
    return next(new Error("Published legal document versions are immutable."))
  }
  return next()
}

LegalDocumentVersionSchema.pre("updateOne", blockPublishedUpdate)
LegalDocumentVersionSchema.pre("findOneAndUpdate", blockPublishedUpdate)

export default (mongoose.models.LegalDocumentVersion ||
  mongoose.model<ILegalDocumentVersion>(
    "LegalDocumentVersion",
    LegalDocumentVersionSchema,
  )) as mongoose.Model<ILegalDocumentVersion>
