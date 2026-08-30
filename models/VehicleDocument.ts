import mongoose, { Document, Schema } from "mongoose"

export type DocumentType =
  | "insurance_certificate"
  | "roadworthiness"
  | "hackney_permit"
  | "vehicle_license"
  | "inspection_certificate"
  | "other"

export type DocumentVerificationStatus = "pending" | "verified" | "expired" | "rejected"

export interface IVehicleDocument extends Document {
  vehicleId: Schema.Types.ObjectId
  documentType: DocumentType
  title: string
  documentNumber?: string
  issuingAuthority?: string
  issueDate: Date
  expiryDate: Date
  fileUrl?: string
  verificationStatus: DocumentVerificationStatus
  rejectionReason?: string
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const VehicleDocumentSchema = new Schema<IVehicleDocument>(
  {
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    documentType: {
      type: String,
      enum: [
        "insurance_certificate",
        "roadworthiness",
        "hackney_permit",
        "vehicle_license",
        "inspection_certificate",
        "other",
      ],
      required: true,
      index: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    documentNumber: {
      type: String,
      trim: true,
    },
    issuingAuthority: {
      type: String,
      trim: true,
    },
    issueDate: {
      type: Date,
      required: true,
    },
    expiryDate: {
      type: Date,
      required: true,
      index: true,
    },
    fileUrl: {
      type: String,
      trim: true,
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "expired", "rejected"],
      default: "pending",
      index: true,
    },
    rejectionReason: {
      type: String,
      trim: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
)

VehicleDocumentSchema.index({ vehicleId: 1, documentType: 1, expiryDate: -1 })

export default (mongoose.models.VehicleDocument ||
  mongoose.model<IVehicleDocument>(
    "VehicleDocument",
    VehicleDocumentSchema,
  )) as mongoose.Model<IVehicleDocument>
