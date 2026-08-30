import mongoose, { Schema } from "mongoose"

const AttemptSchema = new Schema({ attemptedAt: Date, status: String, providerId: String, responseCode: String, error: String }, { _id: false })
const schema = new Schema({
  idempotencyKey: { type: String, required: true, unique: true, index: true }, eventId: { type: String, required: true, index: true },
  eventType: { type: String, required: true }, userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  channel: { type: String, enum: ["in_app", "email"], required: true }, category: String, mandatory: Boolean,
  templateKey: String, templateVersion: Number, notificationId: { type: Schema.Types.ObjectId, ref: "Notification" },
  to: String, subject: String, html: String,
  status: { type: String, enum: ["created", "scheduled", "processing", "delivered", "dead_letter"], default: "created", index: true },
  attempts: { type: [AttemptSchema], default: [] }, attemptCount: { type: Number, default: 0 }, maxAttempts: { type: Number, default: 5 },
  scheduledFor: { type: Date, default: Date.now, index: true }, lockedAt: Date, providerId: String, deliveredAt: Date, failedAt: Date,
}, { timestamps: true })
schema.index({ status: 1, scheduledFor: 1 })
export default mongoose.models.NotificationDelivery || mongoose.model("NotificationDelivery", schema)
