import mongoose, { Schema } from "mongoose"

export interface IStellarDeadLetterEvent {
  network: string
  streamId: string
  sequence: number
  pagingToken: string
  operationId: string
  ledger: number
  transactionHash: string
  eventIndex: number
  contractId?: string
  reason: string
  attempts: number
  replayCount: number
  lastReplayAt?: Date
  resolvedAt?: Date
  raw: Record<string, unknown>
  createdAt: Date
  updatedAt: Date
}

const StellarDeadLetterEventSchema = new Schema<IStellarDeadLetterEvent>(
  {
    network: { type: String, required: true, trim: true, lowercase: true, index: true },
    streamId: { type: String, required: true, trim: true, index: true },
    sequence: { type: Number, required: true, index: true },
    pagingToken: { type: String, required: true, trim: true },
    operationId: { type: String, required: true, trim: true, index: true },
    ledger: { type: Number, required: true, index: true },
    transactionHash: { type: String, required: true, trim: true },
    eventIndex: { type: Number, required: true },
    contractId: { type: String, trim: true, index: true },
    reason: { type: String, required: true },
    attempts: { type: Number, required: true, default: 1 },
    replayCount: { type: Number, required: true, default: 0 },
    lastReplayAt: { type: Date },
    resolvedAt: { type: Date, index: true },
    raw: { type: Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
)

StellarDeadLetterEventSchema.index(
  { network: 1, streamId: 1, ledger: 1, transactionHash: 1, eventIndex: 1 },
  { unique: true },
)
StellarDeadLetterEventSchema.index({ network: 1, streamId: 1, resolvedAt: 1, sequence: 1 })

export default (mongoose.models.StellarDeadLetterEvent ||
  mongoose.model<IStellarDeadLetterEvent>("StellarDeadLetterEvent", StellarDeadLetterEventSchema)) as mongoose.Model<{
  _id: any
  [key: string]: any
}>
