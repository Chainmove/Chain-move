import mongoose, { Document, Schema } from "mongoose"

export interface INotification extends Document {
  userId: string
  createdBy?: Schema.Types.ObjectId
  title: string
  message: string
  type: string
  priority: "low" | "medium" | "high"
  link?: string
  read: boolean
  timestamp: Date
}

const NotificationSchema: Schema = new Schema({
  userId: { type: String, required: true, index: true },
  createdBy: { type: Schema.Types.ObjectId, ref: "User", index: true },
  title: { type: String, required: true, trim: true },
  message: { type: String, required: true, trim: true },
  type: { type: String, trim: true, default: "info" },
  priority: {
    type: String,
    enum: ["low", "medium", "high"],
    default: "low",
  },
  link: {
    type: String,
    trim: true,
  },
  read: { type: Boolean, default: false },
  timestamp: { type: Date, default: Date.now, index: true },
})

export default (mongoose.models.Notification ||
  mongoose.model<INotification>("Notification", NotificationSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;