import mongoose, { Document, Schema } from "mongoose"

export type IncidentSeverity = "minor" | "moderate" | "severe" | "critical"

export type IncidentStatus = "reported" | "under_investigation" | "resolved" | "closed"

export interface IVehicleIncident extends Document {
  incidentNumber: string
  vehicleId: Schema.Types.ObjectId
  driverUserId?: Schema.Types.ObjectId
  contractId?: Schema.Types.ObjectId
  incidentDate: Date
  incidentType: "accident" | "breakdown" | "theft_attempt" | "traffic_violation" | "damage"
  severity: IncidentSeverity
  location?: string
  description: string
  status: IncidentStatus
  estimatedCostImpactNgn: number
  driverStatement?: string
  evidenceUrls: string[]
  internalNotes?: string
  createdAt: Date
  updatedAt: Date
}

const VehicleIncidentSchema = new Schema<IVehicleIncident>(
  {
    incidentNumber: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    driverUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    contractId: {
      type: Schema.Types.ObjectId,
      ref: "HirePurchaseContract",
      index: true,
    },
    incidentDate: {
      type: Date,
      required: true,
      index: true,
    },
    incidentType: {
      type: String,
      enum: ["accident", "breakdown", "theft_attempt", "traffic_violation", "damage"],
      required: true,
    },
    severity: {
      type: String,
      enum: ["minor", "moderate", "severe", "critical"],
      default: "minor",
    },
    location: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    status: {
      type: String,
      enum: ["reported", "under_investigation", "resolved", "closed"],
      default: "reported",
      index: true,
    },
    estimatedCostImpactNgn: {
      type: Number,
      default: 0,
      min: 0,
    },
    driverStatement: {
      type: String,
      trim: true,
    },
    evidenceUrls: {
      type: [String],
      default: [],
    },
    internalNotes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
)

VehicleIncidentSchema.index({ vehicleId: 1, incidentDate: -1 })

export default (mongoose.models.VehicleIncident ||
  mongoose.model<IVehicleIncident>(
    "VehicleIncident",
    VehicleIncidentSchema,
  )) as mongoose.Model<IVehicleIncident>
