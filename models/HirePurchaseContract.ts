import mongoose, { Document, Schema } from "mongoose"

export type HirePurchaseAssetType = "SHUTTLE" | "KEKE"

export type HirePurchaseContractStatus =
  | "PENDING_APPROVAL"
  | "APPROVED"
  | "VEHICLE_ASSIGNED"
  | "ACTIVE"
  | "DELINQUENT"
  | "RESTRUCTURED"
  | "COMPLETED"
  | "REPOSSESSED"
  | "CANCELLED"
  | "CLOSED"

export type HirePurchaseContractTransitionActor = "driver" | "admin" | "system"

export interface IHirePurchaseContractTransition {
  fromState: HirePurchaseContractStatus | null
  toState: HirePurchaseContractStatus
  actorType: HirePurchaseContractTransitionActor
  actorUserId?: Schema.Types.ObjectId
  reason: string
  metadata?: Record<string, unknown>
  timestamp: Date
}

export interface IHirePurchaseContract extends Document {
  driverUserId: Schema.Types.ObjectId
  poolId: Schema.Types.ObjectId
  assetType: HirePurchaseAssetType
  vehicleDisplayName: string
  vehicleId?: Schema.Types.ObjectId
  principalNgn: number
  depositNgn: number
  totalPayableNgn: number
  durationWeeks: number
  durationMonths?: number
  weeklyPaymentNgn: number
  startDate: Date
  status: HirePurchaseContractStatus
  version: number
  consentAcceptanceId: string
  acceptedDocumentSetHash: string
  acceptedDocumentVersionIds: Schema.Types.ObjectId[]
  timeline: IHirePurchaseContractTransition[]
  totalPaidNgn: number
  nextDueDate: Date | null
  createdAt: Date
  updatedAt: Date
}

const HirePurchaseContractTransitionSchema = new Schema<IHirePurchaseContractTransition>(
  {
    fromState: { type: String, default: null },
    toState: { type: String, required: true },
    actorType: {
      type: String,
      enum: ["driver", "admin", "system"],
      required: true,
    },
    actorUserId: { type: Schema.Types.ObjectId, ref: "User" },
    reason: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now },
  },
  { _id: false },
)

const HirePurchaseContractSchema: Schema = new Schema(
  {
    driverUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    poolId: {
      type: Schema.Types.ObjectId,
      ref: "InvestmentPool",
      required: true,
      index: true,
    },
    assetType: {
      type: String,
      enum: ["SHUTTLE", "KEKE"],
      required: true,
    },
    vehicleDisplayName: {
      type: String,
      required: true,
      trim: true,
    },
    vehicleId: {
      type: Schema.Types.ObjectId,
      ref: "Vehicle",
    },
    principalNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    depositNgn: {
      type: Number,
      default: 0,
      min: 0,
    },
    totalPayableNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    durationWeeks: {
      type: Number,
      required: true,
      min: 1,
    },
    durationMonths: {
      type: Number,
      min: 1,
    },
    weeklyPaymentNgn: {
      type: Number,
      required: true,
      min: 0,
    },
    startDate: {
      type: Date,
      required: true,
    },
    status: {
      type: String,
      enum: [
        "PENDING_APPROVAL",
        "APPROVED",
        "VEHICLE_ASSIGNED",
        "ACTIVE",
        "DELINQUENT",
        "RESTRUCTURED",
        "COMPLETED",
        "REPOSSESSED",
        "CANCELLED",
        "CLOSED",
      ],
      default: "PENDING_APPROVAL",
      index: true,
    },
    version: {
      type: Number,
      default: 0,
    },
    consentAcceptanceId: {
      type: String,
      required: false,
      trim: true,
      index: true,
    },
    acceptedDocumentSetHash: {
      type: String,
      required: false,
      trim: true,
      lowercase: true,
      match: /^[a-f0-9]{64}$/,
    },
    acceptedDocumentVersionIds: [{ type: Schema.Types.ObjectId, ref: "LegalDocumentVersion" }],
    timeline: {
      type: [HirePurchaseContractTransitionSchema],
      default: [],
    },
    totalPaidNgn: {
      type: Number,
      default: 0,
      min: 0,
    },
    nextDueDate: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
)

HirePurchaseContractSchema.index({ driverUserId: 1, status: 1, createdAt: -1 })
HirePurchaseContractSchema.index({ poolId: 1, status: 1 })
HirePurchaseContractSchema.index({ vehicleId: 1 }, { sparse: true })
HirePurchaseContractSchema.index({ consentAcceptanceId: 1 }, { sparse: true })

export default (mongoose.models.HirePurchaseContract ||
  mongoose.model<IHirePurchaseContract>("HirePurchaseContract", HirePurchaseContractSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;
