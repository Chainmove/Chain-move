import mongoose, { Schema } from "mongoose"

export type StellarRawEventStatus = "received" | "projected" | "dead_letter"

export interface IStellarRawEvent {
  network: string
  streamId: string
  sequence: number
  pagingToken: string
  ledger: number
  transactionHash: string
  eventIndex: number
  operationId: string
  contractId?: string
  status: StellarRawEventStatus
  attempts: number
  lastError?: string
  projectedAt?: Date
  raw: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

const StellarRawEventSchema = new Schema<IStellarRawEvent>(
  {
    network: { type: String, required: true, trim: true, lowercase: true, index: true },
    streamId: { type: String, required: true, trim: true, index: true },
    sequence: { type: Number, required: true, index: true },
    pagingToken: { type: String, required: true, trim: true, index: true },
    ledger: { type: Number, required: true, index: true },
    transactionHash: { type: String, required: true, trim: true },
    eventIndex: { type: Number, required: true, min: 0 },
    operationId: { type: String, required: true, trim: true, index: true },
    contractId: { type: String, trim: true, index: true },
    status: {
      type: String,
      enum: ["received", "projected", "dead_letter"],
      required: true,
      default: "received",
      index: true,
    },
    attempts: { type: Number, required: true, default: 0, min: 0 },
    lastError: { type: String },
    projectedAt: { type: Date },
    raw: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
)

StellarRawEventSchema.index(
  { network: 1, streamId: 1, ledger: 1, transactionHash: 1, eventIndex: 1 },
  { unique: true },
)
StellarRawEventSchema.index({ network: 1, streamId: 1, sequence: 1 }, { unique: true })
StellarRawEventSchema.index({ network: 1, streamId: 1, status: 1, sequence: 1 })

export default (mongoose.models.StellarRawEvent ||
  mongoose.model<IStellarRawEvent>("StellarRawEvent", StellarRawEventSchema)) as mongoose.Model<{
  _id: any
  [key: string]: any
}>
