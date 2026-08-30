import mongoose, { Document, Schema } from "mongoose"

export type InsuranceType = "comprehensive" | "third_party" | "third_party_fire_theft"

export type InsuranceStatus = "active" | "expired" | "cancelled" | "pending"

export interface IVehicleInsurancePolicy extends Document {
  vehicleId: Schema.Types.ObjectId
  providerName: string
  policyNumber: string
  insuranceType: InsuranceType
  startDate: Date
  endDate: Date
  premiumAmountNgn: number
  coverageDetails?: string
  status: InsuranceStatus
  documentUrl?: string
  createdAt: Date
  updatedAt: Date
}

const VehicleInsurancePolicySchema = new Schema<IVehicleInsurancePolicy>(
  {
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    providerName: {
      type: String,
      required: true,
      trim: true,
    },
    policyNumber: {
      type: String,
      required: true,
      trim: true,
    },
    insuranceType: {
      type: String,
      enum: ["comprehensive", "third_party", "third_party_fire_theft"],
      required: true,
    },
    startDate: {
      type: Date,
      required: true,
    },
    endDate: {
      type: Date,
      required: true,
      index: true,
    },
    premiumAmountNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    coverageDetails: {
      type: String,
      trim: true,
    },
    status: {
      type: String,
      enum: ["active", "expired", "cancelled", "pending"],
      default: "active",
      index: true,
    },
    documentUrl: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
)

VehicleInsurancePolicySchema.index({ vehicleId: 1, startDate: 1, endDate: 1 })

export default (mongoose.models.VehicleInsurancePolicy ||
  mongoose.model<IVehicleInsurancePolicy>(
    "VehicleInsurancePolicy",
    VehicleInsurancePolicySchema,
  )) as mongoose.Model<IVehicleInsurancePolicy>
