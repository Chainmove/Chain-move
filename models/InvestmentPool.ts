import mongoose, { Document, Schema } from "mongoose"

export type PoolAssetType = "SHUTTLE" | "KEKE"

/**
 * Full lifecycle states for a vehicle investment pool.
 *
 * Transition matrix (see pool-lifecycle.service.ts for enforcement):
 *
 *   draft       → review | cancelled
 *   review      → funding | cancelled
 *   funding     → fully_funded | closing | cancelled
 *   fully_funded→ closing | cancelled
 *   closing     → active | cancelled
 *   active      → paused | completed | cancelled
 *   paused      → active | cancelled
 *   completed   → archived
 *   cancelled   → (terminal)
 *   archived    → (terminal)
 *
 * Legacy statuses are mapped on read: OPEN→funding, FUNDED→fully_funded, CLOSED→completed.
 */
export type PoolStatus =
  | "draft"
  | "review"
  | "funding"
  | "fully_funded"
  | "closing"
  | "active"
  | "paused"
  | "completed"
  | "cancelled"
  | "archived"
  // Legacy aliases kept for backwards-compat reads
  | "OPEN"
  | "FUNDED"
  | "CLOSED"

export interface IInvestmentPool extends Document {
  assetType: PoolAssetType
  assetPriceNgn: number
  targetAmountNgn: number
  minContributionNgn: number
  status: PoolStatus
  currentRaisedNgn: number
  investorCount: number
  createdBy: Schema.Types.ObjectId
  description?: string
  /** Set when funding closes; investments beyond this amount are rejected */
  fundingCapacityNgn: number | null
  /** Deadline for funding; after this an underfunded pool auto-cancels */
  fundingDeadline: Date | null
  /** Optimistic concurrency version field */
  __v: number
  createdAt: Date
  updatedAt: Date
}

const InvestmentPoolSchema: Schema = new Schema(
  {
    assetType: {
      type: String,
      enum: ["SHUTTLE", "KEKE"],
      required: true,
    },
    assetPriceNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    targetAmountNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    minContributionNgn: {
      type: Number,
      required: true,
      min: 0,
      default: 5000,
    },
    status: {
      type: String,
      enum: [
        "draft",
        "review",
        "funding",
        "fully_funded",
        "closing",
        "active",
        "paused",
        "completed",
        "cancelled",
        "archived",
        // Legacy aliases
        "OPEN",
        "FUNDED",
        "CLOSED",
      ],
      default: "draft",
      index: true,
    },
    fundingDeadline: { type: Date },
    closedFundingAt: { type: Date },
    activatedAt: { type: Date },
    completedAt: { type: Date },
    cancelledAt: { type: Date },
    cancellationReason: { type: String, trim: true, maxlength: 400 },
    schemaVersion: { type: Number, default: 2 },
    currentRaisedNgn: {
      type: Number,
      default: 0,
      min: 0,
    },
    investorCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    createdBy: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 600,
    },
    fundingCapacityNgn: {
      type: Number,
      default: null,
      min: 0,
    },
    fundingDeadline: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true, optimisticConcurrency: true },
)

export default (mongoose.models.InvestmentPool ||
  mongoose.model<IInvestmentPool>("InvestmentPool", InvestmentPoolSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;