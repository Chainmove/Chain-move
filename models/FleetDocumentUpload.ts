import mongoose, { Schema, type Document } from "mongoose"

import { FLEET_DOCUMENT_TYPES, type FleetDocumentType } from "@/lib/security/fleet-documents"

export type FleetDocumentUploadStatus = "active" | "deleted"

export interface IFleetDocumentUpload extends Document {
  _id: mongoose.Types.ObjectId
  vehicleId: mongoose.Types.ObjectId
  uploadedBy: mongoose.Types.ObjectId
  documentType: FleetDocumentType
  status: FleetDocumentUploadStatus
  storageKey: string
  blobUrl: string
  originalFilename: string
  contentType: string
  fileSize: number
  checksumSha256: string
  retentionExpiresAt?: Date
  deletedAt?: Date
  deletedBy?: mongoose.Types.ObjectId
  accessCount: number
  lastAccessedAt?: Date
  lastAccessedBy?: mongoose.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const FleetDocumentUploadSchema = new Schema<IFleetDocumentUpload>(
  {
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    uploadedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      enum: FLEET_DOCUMENT_TYPES,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["active", "deleted"],
      default: "active",
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
    originalFilename: {
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
    retentionExpiresAt: {
      type: Date,
      index: true,
    },
    deletedAt: {
      type: Date,
    },
    deletedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
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

FleetDocumentUploadSchema.index({ vehicleId: 1, documentType: 1 })
FleetDocumentUploadSchema.index({ status: 1, retentionExpiresAt: 1 })

export default (mongoose.models.FleetDocumentUpload ||
  mongoose.model<IFleetDocumentUpload>(
    "FleetDocumentUpload",
    FleetDocumentUploadSchema,
  )) as mongoose.Model<IFleetDocumentUpload>
