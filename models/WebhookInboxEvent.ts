import crypto from "crypto"
import mongoose, { Document, Schema } from "mongoose"

export type WebhookInboxStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "dead_letter"

export interface IWebhookInboxEvent extends Document {
  providerEventId: string
  eventType: string
  payloadHash: string
  rawPayload: string
  status: WebhookInboxStatus
  attempts: number
  maxAttempts: number
  nextRetryAt: Date | null
  lastError: string | null
  correlationId: string
  processedAt: Date | null
  replayedAt: Date | null
  replayedBy: string | null
  replayReason: string | null
  createdAt: Date
  updatedAt: Date
}

const WebhookInboxEventSchema = new Schema<IWebhookInboxEvent>(
  {
    providerEventId: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    payloadHash: {
      type: String,
      required: true,
    },
    rawPayload: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "failed", "dead_letter"],
      default: "pending",
      index: true,
    },
    attempts: {
      type: Number,
      default: 0,
      min: 0,
    },
    maxAttempts: {
      type: Number,
      default: 5,
    },
    nextRetryAt: {
      type: Date,
      default: null,
      index: true,
    },
    lastError: {
      type: String,
      default: null,
    },
    correlationId: {
      type: String,
      required: true,
      default: () => new mongoose.Types.ObjectId().toHexString(),
      index: true,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    replayedAt: {
      type: Date,
      default: null,
    },
    replayedBy: {
      type: String,
      default: null,
    },
    replayReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
)

// Unique per provider event ID to prevent duplicate ingestion
WebhookInboxEventSchema.index({ providerEventId: 1 }, { unique: true })

// Hash the payload to detect conflicting deliveries for the same reference
WebhookInboxEventSchema.index({ providerEventId: 1, payloadHash: 1 })

export function hashPayload(raw: string): string {
  return crypto.createHash("sha256").update(raw).digest("hex")
}

/** Exponential backoff in seconds: 30s, 2m, 8m, 32m, 2h */
export function computeNextRetryAt(attempts: number): Date {
  const delaySeconds = Math.min(30 * Math.pow(4, attempts - 1), 7200)
  return new Date(Date.now() + delaySeconds * 1000)
}

export default (mongoose.models.WebhookInboxEvent ||
  mongoose.model<IWebhookInboxEvent>(
    "WebhookInboxEvent",
    WebhookInboxEventSchema,
  )) as mongoose.Model<IWebhookInboxEvent>
