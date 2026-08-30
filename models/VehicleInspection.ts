import mongoose, { Document, Schema } from "mongoose"

export type InspectionType =
  | "pre_delivery"
  | "routine"
  | "post_incident"
  | "return_to_service"

export type InspectionResult = "passed" | "failed" | "conditional"

export interface IInspectionCheckitem {
  category: string
  item: string
  passed: boolean
  isCritical: boolean
  notes?: string
}

export interface IVehicleInspection extends Document {
  vehicleId: Schema.Types.ObjectId
  inspectionType: InspectionType
  inspectorUserId?: Schema.Types.ObjectId
  inspectorName?: string
  inspectionDate: Date
  odometerReading?: number
  overallResult: InspectionResult
  hasCriticalFailure: boolean
  checklist: IInspectionCheckitem[]
  failureReason?: string
  returnToServiceAuthorizedBy?: Schema.Types.ObjectId
  returnToServiceNotes?: string
  createdAt: Date
  updatedAt: Date
}

const InspectionCheckitemSchema = new Schema<IInspectionCheckitem>(
  {
    category: { type: String, required: true },
    item: { type: String, required: true },
    passed: { type: Boolean, required: true },
    isCritical: { type: Boolean, default: false },
    notes: { type: String, trim: true },
  },
  { _id: false },
)

const VehicleInspectionSchema = new Schema<IVehicleInspection>(
  {
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    inspectionType: {
      type: String,
      enum: ["pre_delivery", "routine", "post_incident", "return_to_service"],
      required: true,
      index: true,
    },
    inspectorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    inspectorName: {
      type: String,
      trim: true,
    },
    inspectionDate: {
      type: Date,
      default: Date.now,
      index: true,
    },
    odometerReading: {
      type: Number,
      min: 0,
    },
    overallResult: {
      type: String,
      enum: ["passed", "failed", "conditional"],
      required: true,
      index: true,
    },
    hasCriticalFailure: {
      type: Boolean,
      default: false,
      index: true,
    },
    checklist: {
      type: [InspectionCheckitemSchema],
      default: [],
    },
    failureReason: {
      type: String,
      trim: true,
    },
    returnToServiceAuthorizedBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    returnToServiceNotes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
)

VehicleInspectionSchema.index({ vehicleId: 1, inspectionDate: -1 })

export default (mongoose.models.VehicleInspection ||
  mongoose.model<IVehicleInspection>(
    "VehicleInspection",
    VehicleInspectionSchema,
  )) as mongoose.Model<IVehicleInspection>
