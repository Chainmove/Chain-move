import mongoose, { Document, Schema } from "mongoose"

export type MaintenanceState =
  | "reported"
  | "triaged"
  | "approved"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "verified"
  | "cancelled"

export interface ICostAdjustment {
  previousEstimate: number
  newEstimate: number
  reason: string
  adjustedByUserId: Schema.Types.ObjectId
  timestamp: Date
}

export interface IVehicleMaintenanceOrder extends Document {
  workOrderNumber: string
  vehicleId: Schema.Types.ObjectId
  driverUserId?: Schema.Types.ObjectId
  reportedByUserId?: Schema.Types.ObjectId
  issueTitle: string
  description: string
  category: "routine_service" | "repair" | "emergency" | "inspection" | "accident_repair"
  state: MaintenanceState
  vendorName?: string
  vendorContact?: string
  estimatedCostNgn: number
  finalCostNgn: number
  costAdjustmentHistory: ICostAdjustment[]
  evidenceUrls: string[]
  scheduledDate?: Date
  completionDate?: Date
  verifiedDate?: Date
  verifiedByUserId?: Schema.Types.ObjectId
  driverNotes?: string
  internalNotes?: string // Admin/Vendor private notes, excluded from driver response projection
  createdAt: Date
  updatedAt: Date
}

const CostAdjustmentSchema = new Schema<ICostAdjustment>(
  {
    previousEstimate: { type: Number, required: true },
    newEstimate: { type: Number, required: true },
    reason: { type: String, required: true, trim: true },
    adjustedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
)

const VehicleMaintenanceOrderSchema = new Schema<IVehicleMaintenanceOrder>(
  {
    workOrderNumber: {
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
    reportedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    issueTitle: {
      type: String,
      required: true,
      trim: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      enum: ["routine_service", "repair", "emergency", "inspection", "accident_repair"],
      default: "repair",
    },
    state: {
      type: String,
      enum: [
        "reported",
        "triaged",
        "approved",
        "scheduled",
        "in_progress",
        "completed",
        "verified",
        "cancelled",
      ],
      default: "reported",
      index: true,
    },
    vendorName: {
      type: String,
      trim: true,
    },
    vendorContact: {
      type: String,
      trim: true,
    },
    estimatedCostNgn: {
      type: Number,
      default: 0,
      min: 0,
    },
    finalCostNgn: {
      type: Number,
      default: 0,
      min: 0,
    },
    costAdjustmentHistory: {
      type: [CostAdjustmentSchema],
      default: [],
    },
    evidenceUrls: {
      type: [String],
      default: [],
    },
    scheduledDate: {
      type: Date,
    },
    completionDate: {
      type: Date,
    },
    verifiedDate: {
      type: Date,
    },
    verifiedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    driverNotes: {
      type: String,
      trim: true,
    },
    internalNotes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
)

VehicleMaintenanceOrderSchema.index({ vehicleId: 1, state: 1 })

export default (mongoose.models.VehicleMaintenanceOrder ||
  mongoose.model<IVehicleMaintenanceOrder>(
    "VehicleMaintenanceOrder",
    VehicleMaintenanceOrderSchema,
  )) as mongoose.Model<IVehicleMaintenanceOrder>
