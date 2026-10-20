import mongoose, { Document, Schema } from "mongoose"

export type PoolAssetType = "SHUTTLE" | "KEKE"

/**
 * Full pool lifecycle state machine (issue #90).
 *
 * Allowed transitions:
 *   draft      → review | cancelled
 *   review     → funding | cancelled
 *   funding    → fully_funded | closing | cancelled
 *   fully_funded → closing | cancelled
 *   closing    → active | cancelled
 *   active     → paused | completed | cancelled
 *   paused     → active | cancelled
 *   completed  → archived
 *   cancelled  → (terminal)
 *   archived   → (terminal)
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

/** Backward-compatible alias so existing OPEN/FUNDED/CLOSED references keep compiling. */
export const LEGACY_STATUS_MAP: Record<string, PoolStatus> = {
  OPEN: "funding",
  FUNDED: "fully_funded",
  CLOSED: "completed",
}

export const POOL_TRANSITIONS: Record<PoolStatus, PoolStatus[]> = {
  draft: ["review", "cancelled"],
  review: ["funding", "cancelled"],
  funding: ["fully_funded", "closing", "cancelled"],
  fully_funded: ["closing", "cancelled"],
  closing: ["active", "cancelled"],
  active: ["paused", "completed", "cancelled"],
  paused: ["active", "cancelled"],
  completed: ["archived"],
  cancelled: [],
  archived: [],
}

/**
 * Returns true when the transition from→to is permitted.
 */
export function isValidPoolTransition(from: PoolStatus, to: PoolStatus): boolean {
  return (POOL_TRANSITIONS[from] ?? []).includes(to)
}

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
  fundingDeadline?: Date
  closedFundingAt?: Date
  activatedAt?: Date
  completedAt?: Date
  cancelledAt?: Date
  cancellationReason?: string
  schemaVersion: number
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
        // Legacy values retained for backward-compatible reads during migration
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
  },
  { timestamps: true },
)

export default (mongoose.models.InvestmentPool ||
  mongoose.model<IInvestmentPool>("InvestmentPool", InvestmentPoolSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;