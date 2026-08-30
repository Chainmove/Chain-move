import mongoose, { Document, Schema } from "mongoose"

export type OdometerSource = "inspection" | "driver_checkin" | "telematics" | "maintenance" | "manual_admin"

export interface IVehicleOdometerReading extends Document {
  vehicleId: Schema.Types.ObjectId
  readingKm: number
  recordedAt: Date
  source: OdometerSource
  recordedByUserId?: Schema.Types.ObjectId
  notes?: string
  createdAt: Date
  updatedAt: Date
}

const VehicleOdometerReadingSchema = new Schema<IVehicleOdometerReading>(
  {
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
      required: true,
      index: true,
    },
    readingKm: {
      type: Number,
      required: true,
      min: 0,
    },
    recordedAt: {
      type: Date,
      default: Date.now,
      index: true,
    },
    source: {
      type: String,
      enum: ["inspection", "driver_checkin", "telematics", "maintenance", "manual_admin"],
      required: true,
    },
    recordedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
)

VehicleOdometerReadingSchema.index({ vehicleId: 1, recordedAt: -1 })

export default (mongoose.models.VehicleOdometerReading ||
  mongoose.model<IVehicleOdometerReading>(
    "VehicleOdometerReading",
    VehicleOdometerReadingSchema,
  )) as mongoose.Model<IVehicleOdometerReading>
