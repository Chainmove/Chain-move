import mongoose, { Document, Schema } from "mongoose"

export type ReconciliationRunStatus = "in_progress" | "completed" | "failed"
export type ReconciliationProvider = "paystack" | "stripe" | "flutterwave" | "custom"

export interface IReconciliationRunTotals {
  providerTotal: number
  internalTotal: number
  discrepancyTotal: number
  remediatedTotal: number
  matchedCount: number
  unmatchedCount: number
}

export interface IReconciliationRunOperator {
  userId?: Schema.Types.ObjectId
  userAgent?: string
  ipAddress?: string
}

export interface IReconciliationRunMetrics {
  totalProviderRecords: number
  totalInternalRecords: number
  matchedRecords: number
  discrepancyCount: number
  remediatedCount: number
}

export interface IReconciliationRun extends Document {
  runId: string
  provider: ReconciliationProvider
  periodStart: Date
  periodEnd: Date
  status: ReconciliationRunStatus
  startedAt: Date
  completedAt?: Date
  triggeredBy: string
  operator?: IReconciliationRunOperator
  totals: IReconciliationRunTotals
  metrics: IReconciliationRunMetrics
  errorMessage?: string
  createdAt: Date
  updatedAt: Date
}

const ReconciliationRunSchema = new Schema<IReconciliationRun>(
  {
    runId: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      index: true,
    },
    provider: {
      type: String,
      enum: ["paystack", "stripe", "flutterwave", "custom"],
      default: "paystack",
      required: true,
      index: true,
    },
    periodStart: {
      type: Date,
      required: true,
      index: true,
    },
    periodEnd: {
      type: Date,
      required: true,
      index: true,
    },
    status: {
      type: String,
      enum: ["in_progress", "completed", "failed"],
      default: "in_progress",
      index: true,
    },
    startedAt: {
      type: Date,
      default: Date.now,
    },
    completedAt: {
      type: Date,
    },
    triggeredBy: {
      type: String,
      default: "system",
      trim: true,
    },
    operator: {
      userId: {
        type: Schema.Types.ObjectId,
        ref: "User",
      },
      userAgent: {
        type: String,
        trim: true,
      },
      ipAddress: {
        type: String,
        trim: true,
      },
    },
    totals: {
      providerTotal: { type: Number, default: 0 },
      internalTotal: { type: Number, default: 0 },
      discrepancyTotal: { type: Number, default: 0 },
      remediatedTotal: { type: Number, default: 0 },
      matchedCount: { type: Number, default: 0 },
      unmatchedCount: { type: Number, default: 0 },
    },
    metrics: {
      totalProviderRecords: { type: Number, default: 0 },
      totalInternalRecords: { type: Number, default: 0 },
      matchedRecords: { type: Number, default: 0 },
      discrepancyCount: { type: Number, default: 0 },
      remediatedCount: { type: Number, default: 0 },
    },
    errorMessage: {
      type: String,
      trim: true,
    },
  },
  { timestamps: true },
)

ReconciliationRunSchema.index({ periodStart: 1, periodEnd: 1 })
ReconciliationRunSchema.index({ provider: 1, status: 1 })
ReconciliationRunSchema.index({ "operator.userId": 1 })

export default (mongoose.models.ReconciliationRun ||
  mongoose.model<IReconciliationRun>(
    "ReconciliationRun",
    ReconciliationRunSchema,
  )) as mongoose.Model<IReconciliationRun>
