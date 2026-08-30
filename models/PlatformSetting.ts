import mongoose, { Document, Schema } from "mongoose"

export interface IPlatformSetting extends Document {
  singletonKey: string
  minimumContributionNgn: number
  platformFeeRateBps: number
  defaultRepaymentDurationWeeks: number
  defaultRoiPercent: number
  updatedByUserId?: Schema.Types.ObjectId
  createdAt: Date
  updatedAt: Date
}

const PlatformSettingSchema = new Schema<IPlatformSetting>(
  {
    singletonKey: {
      type: String,
      required: true,
      unique: true,
      default: "default",
    },
    minimumContributionNgn: {
      type: Number,
      min: 0,
      default: 5000,
    },
    platformFeeRateBps: {
      type: Number,
      min: 0,
      max: 10000,
      default: 250,
    },
    defaultRepaymentDurationWeeks: {
      type: Number,
      min: 1,
      default: 52,
    },
    defaultRoiPercent: {
      type: Number,
      min: 0,
      max: 100,
      default: 24,
    },
    updatedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false,
    },
  },
  { timestamps: true },
)

export default (mongoose.models.PlatformSetting ||
  mongoose.model<IPlatformSetting>("PlatformSetting", PlatformSettingSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;