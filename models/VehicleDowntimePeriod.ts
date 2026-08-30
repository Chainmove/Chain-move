import mongoose, { Document, Schema } from "mongoose"

export type DowntimeReason =
  | "scheduled_maintenance"
  | "unscheduled_repair"
  | "accident_damage"
  | "compliance_hold"
  | "inspection_failure"
  | "other"

export interface IVehicleDowntimePeriod extends Document {
  vehicleId: Schema.Types.ObjectId
  driverUserId?: Schema.Types.ObjectId
  contractId?: Schema.Types.ObjectId
  maintenanceOrderId?: Schema.Types.ObjectId
  incidentId?: Schema.Types.ObjectId
  startTime: Date
  endTime?: Date
  reason: DowntimeReason
  notes?: string
  totalDowntimeHours?: number
  repaymentPolicyEffect: "no_pause" | "payment_paused" | "credit_issued" | "term_extended"
  policyNotes?: string
  createdAt: Date
  updatedAt: Date
}

const VehicleDowntimePeriodSchema = new Schema<IVehicleDowntimePeriod>(
  {
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    driverUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    contractId: {
      type: Schema.Types.ObjectId,
      ref: "HirePurchaseContract",
    },
    maintenanceOrderId: {
      type: Schema.Types.ObjectId,
      ref: "VehicleMaintenanceOrder",
    },
    incidentId: {
      type: Schema.Types.ObjectId,
      ref: "VehicleIncident",
    },
    startTime: {
      type: Date,
      required: true,
      index: true,
    },
    endTime: {
      type: Date,
      index: true,
    },
    reason: {
      type: String,
      enum: [
        "scheduled_maintenance",
        "unscheduled_repair",
        "accident_damage",
        "compliance_hold",
        "inspection_failure",
        "other",
      ],
      required: true,
    },
    notes: {
      type: String,
      trim: true,
    },
    totalDowntimeHours: {
      type: Number,
      min: 0,
    },
    repaymentPolicyEffect: {
      type: String,
      enum: ["no_pause", "payment_paused", "credit_issued", "term_extended"],
      default: "no_pause",
    },
    policyNotes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
)

VehicleDowntimePeriodSchema.index({ vehicleId: 1, startTime: 1, endTime: 1 })

export default (mongoose.models.VehicleDowntimePeriod ||
  mongoose.model<IVehicleDowntimePeriod>(
    "VehicleDowntimePeriod",
    VehicleDowntimePeriodSchema,
  )) as mongoose.Model<IVehicleDowntimePeriod>
