import crypto from "crypto"
import mongoose, { Document, Schema } from "mongoose"

export type WebhookInboxStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "dead_letter"

export interface IWebhookInboxEvent extends Document {
  provider: string
  providerEventId: string
  eventType: string
  payloadHash: string
  rawPayload: Record<string, unknown>
  status: WebhookInboxStatus
  attempts: number
  maxAttempts: number
  nextRetryAt?: Date
  lastError?: string
  correlationId: string
  processedAt?: Date
  replayedAt?: Date
  replayReason?: string
  replayedBy?: Schema.Types.ObjectId
  receivedAt: Date
  createdAt: Date
  updatedAt: Date
}

const WebhookInboxEventSchema = new Schema<IWebhookInboxEvent>(
  {
    provider: { type: String, required: true, index: true },
    providerEventId: { type: String, required: true },
    eventType: { type: String, required: true, index: true },
    payloadHash: { type: String, required: true },
    rawPayload: { type: Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "dead_letter"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0, min: 0 },
    maxAttempts: { type: Number, default: 5 },
    nextRetryAt: { type: Date, index: true },
    lastError: { type: String, trim: true },
    correlationId: { type: String, required: true, trim: true, index: true },
    processedAt: { type: Date },
    replayedAt: { type: Date },
    replayReason: { type: String, trim: true },
    replayedBy: { type: Schema.Types.ObjectId, ref: "User" },
    receivedAt: { type: Date, default: Date.now, required: true },
  },
  { timestamps: true },
)

// Unique: same provider event ID + same hash = duplicate delivery
WebhookInboxEventSchema.index({ provider: 1, providerEventId: 1, payloadHash: 1 }, { unique: true })
// Detect conflicting payload for same reference (different hash)
WebhookInboxEventSchema.index({ provider: 1, providerEventId: 1 })

/**
 * Compute a stable SHA-256 hash of the raw event payload for deduplication.
 */
export function hashPayload(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

/**
 * Compute next retry delay using exponential backoff (base 30 s, max 1 h).
 */
export function nextRetryDelay(attempts: number): number {
  const base = 30_000
  const max = 3_600_000
  return Math.min(base * Math.pow(2, attempts), max)
}

export default (mongoose.models.WebhookInboxEvent ||
  mongoose.model<IWebhookInboxEvent>(
    "WebhookInboxEvent",
    WebhookInboxEventSchema,
  )) as mongoose.Model<IWebhookInboxEvent>
