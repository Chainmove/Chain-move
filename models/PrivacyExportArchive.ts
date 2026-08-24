import mongoose from "mongoose"

export type PrivacyExportArchiveStatus =
  | "BUILDING"
  | "READY"
  | "EXPIRED"
  | "REVOKED"
  | "FAILED"

/**
 * Persisted record of a user data export. The actual export payload lives on
 * disk (or in another storage backend) and is encrypted at rest with a
 * time-limited download token. The archive is never reused across users.
 */
export interface IPrivacyExportArchive {
  _id: any
  /** Stable application-level identifier surfaced to the user. */
  archiveId: string
  userId: string
  /** Identifier of the originating PrivacyRequest. */
  requestId: string
  status: PrivacyExportArchiveStatus
  /** Path or storage key for the encrypted payload on disk. */
  storagePath: string
  /** SHA-256 checksum of the encrypted payload for integrity verification. */
  checksumSha256: string
  /** Size in bytes of the encrypted payload. */
  byteSize: number
  /** Key version recorded by the encryption layer. */
  encryptionKeyVersion: string
  /** Algorithms used by the encryption layer (e.g. aes-256-gcm). */
  encryptionAlgorithm: string
  /** Number of plain-text sections bundled in the archive (data-map steps). */
  sectionCount: number
  /** Approximate number of records included across all sections. */
  recordCount: number
  /** Token a holder presents to download the archive. */
  downloadToken: string
  /** When the archive becomes eligible for automatic deletion. */
  expiresAt: Date
  /** Set when the archive is downloaded at least once. */
  downloadedAt?: Date
  downloadCount: number
  revokedAt?: Date
  revokedBy?: string
  revokeReason?: string
  failureReason?: string
  /** Whether the archive has been wiped from underlying storage. */
  wipedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const PrivacyExportArchiveSchema = new mongoose.Schema<IPrivacyExportArchive>(
  {
    archiveId: {
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
    },
    requestId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["BUILDING", "READY", "EXPIRED", "REVOKED", "FAILED"],
      required: true,
      default: "BUILDING",
      index: true,
    },
    storagePath: { type: String, required: true, trim: true },
    checksumSha256: { type: String, required: true, trim: true },
    byteSize: { type: Number, required: true, min: 0 },
    encryptionKeyVersion: { type: String, required: true, trim: true },
    encryptionAlgorithm: { type: String, required: true, trim: true },
    sectionCount: { type: Number, required: true, min: 0 },
    recordCount: { type: Number, required: true, min: 0 },
    downloadToken: { type: String, required: true, trim: true },
    expiresAt: { type: Date, required: true, index: true },
    downloadedAt: { type: Date },
    downloadCount: { type: Number, default: 0, min: 0 },
    revokedAt: { type: Date },
    revokedBy: { type: String, trim: true },
    revokeReason: { type: String, trim: true, maxlength: 500 },
    failureReason: { type: String, trim: true, maxlength: 1000 },
    wipedAt: { type: Date },
  },
  { timestamps: true },
)

PrivacyExportArchiveSchema.index({ status: 1, expiresAt: 1 })
PrivacyExportArchiveSchema.index({ userId: 1, status: 1 })

export default (mongoose.models.PrivacyExportArchive ||
  mongoose.model<IPrivacyExportArchive>(
    "PrivacyExportArchive",
    PrivacyExportArchiveSchema,
  )) as mongoose.Model<IPrivacyExportArchive>
