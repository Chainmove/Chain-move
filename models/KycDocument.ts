import mongoose, { Schema, type Document } from "mongoose"

export type KycDocumentType = "identity" | "proof_of_address" | "bvn" | "nin" | "other"
export type KycDocumentStatus = "pending" | "quarantined" | "approved" | "rejected" | "deleted" | "expired"
export type KycScanVerdict = "clean" | "suspicious" | "malicious" | "pending"

export interface IKycDocument extends Document {
  _id: mongoose.Types.ObjectId
  userId: mongoose.Types.ObjectId
  documentType: KycDocumentType
  status: KycDocumentStatus
  storageKey: string
  blobUrl: string
  encryptedRef: string
  originalFilename: string
  sanitizedFilename: string
  contentType: string
  fileSize: number
  checksumSha256: string
  encryptionKeyVersion: string
  scanVerdict: KycScanVerdict
  scanDetails?: Record<string, unknown>
  quarantinedAt?: Date
  reviewedAt?: Date
  reviewedBy?: mongoose.Types.ObjectId
  rejectionReason?: string
  retentionExpiresAt?: Date
  legalHold: boolean
  deletedAt?: Date
  deletedBy?: mongoose.Types.ObjectId
  replacementDocumentId?: mongoose.Types.ObjectId
  accessCount: number
  lastAccessedAt?: Date
  lastAccessedBy?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const KycDocumentSchema = new Schema<IKycDocument>(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      enum: ["identity", "proof_of_address", "bvn", "nin", "other"],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "quarantined", "approved", "rejected", "deleted", "expired"],
      default: "pending",
      required: true,
      index: true,
    },
    storageKey: {
      type: String,
      required: true,
      unique: true,
      trim: true,
    },
    blobUrl: {
      type: String,
      required: true,
      trim: true,
    },
    encryptedRef: {
      type: String,
      required: true,
      trim: true,
    },
    originalFilename: {
      type: String,
      required: true,
      trim: true,
    },
    sanitizedFilename: {
      type: String,
      required: true,
      trim: true,
    },
    contentType: {
      type: String,
      required: true,
      trim: true,
    },
    fileSize: {
      type: Number,
      required: true,
      min: 1,
    },
    checksumSha256: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    encryptionKeyVersion: {
      type: String,
      required: true,
      trim: true,
    },
    scanVerdict: {
      type: String,
      enum: ["clean", "suspicious", "malicious", "pending"],
      default: "pending",
      required: true,
    },
    scanDetails: {
      type: Schema.Types.Mixed,
    },
    quarantinedAt: {
      type: Date,
    },
    reviewedAt: {
      type: Date,
    },
    reviewedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    rejectionReason: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    retentionExpiresAt: {
      type: Date,
      index: true,
    },
    legalHold: {
      type: Boolean,
      default: false,
      index: true,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    replacementDocumentId: {
      type: Schema.Types.ObjectId,
      ref: "KycDocument",
    },
    accessCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastAccessedAt: {
      type: Date,
    },
    lastAccessedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
  },
  {
    timestamps: true,
  },
)

KycDocumentSchema.index({ userId: 1, status: 1 })
KycDocumentSchema.index({ userId: 1, documentType: 1 })
KycDocumentSchema.index({ status: 1, retentionExpiresAt: 1 })
KycDocumentSchema.index({ status: 1, scanVerdict: 1 })

export default (mongoose.models.KycDocument ||
  mongoose.model<IKycDocument>("KycDocument", KycDocumentSchema)) as mongoose.Model<{
  _id: any
  [key: string]: any
}>
