import mongoose, { Schema, type Document } from "mongoose"

export interface IAuditCheckpoint extends Document {
  partition: string
  checkpointNumber: number
  startSequence: number
  endSequence: number
  startEventHash: string
  endEventHash: string
  rootHash: string
  signature: string
  signedBy: string // key identifier
  signedAt: Date
  eventCount: number
  metadata?: Record<string, unknown>
  createdAt: Date
}

const AuditCheckpointSchema = new Schema<IAuditCheckpoint>(
  {
    partition: {
      type: String,
      required: true,
      index: true,
    },
    checkpointNumber: {
      type: Number,
      required: true,
    },
    startSequence: {
      type: Number,
      required: true,
    },
    endSequence: {
      type: Number,
      required: true,
    },
    startEventHash: {
      type: String,
      required: true,
    },
    endEventHash: {
      type: String,
      required: true,
    },
    rootHash: {
      type: String,
      required: true,
    },
    signature: {
      type: String,
      required: true,
    },
    signedBy: {
      type: String,
      required: true,
    },
    signedAt: {
      type: Date,
      required: true,
    },
    eventCount: {
      type: Number,
      required: true,
    },
    metadata: {
      type: Schema.Types.Mixed,
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: false },
  },
)

// Compound index for partition and checkpoint number
AuditCheckpointSchema.index({ partition: 1, checkpointNumber: 1 }, { unique: true })
AuditCheckpointSchema.index({ signedAt: -1 })

// Prevent modifications
AuditCheckpointSchema.pre("save", function (next) {
  if (!this.isNew) {
    throw new Error("CHECKPOINT_IMMUTABLE: Checkpoints cannot be modified")
  }
  next()
})

AuditCheckpointSchema.pre("findOneAndUpdate", function (next) {
  next(new Error("CHECKPOINT_IMMUTABLE: Checkpoints cannot be modified"))
})

AuditCheckpointSchema.pre("updateOne", function (next) {
  next(new Error("CHECKPOINT_IMMUTABLE: Checkpoints cannot be modified"))
})

AuditCheckpointSchema.pre("updateMany", function (next) {
  next(new Error("CHECKPOINT_IMMUTABLE: Checkpoints cannot be modified"))
})

AuditCheckpointSchema.pre("findOneAndDelete", function (next) {
  next(new Error("CHECKPOINT_IMMUTABLE: Checkpoints cannot be deleted"))
})

AuditCheckpointSchema.pre("deleteOne", function (next) {
  next(new Error("CHECKPOINT_IMMUTABLE: Checkpoints cannot be deleted"))
})

AuditCheckpointSchema.pre("deleteMany", function (next) {
  next(new Error("CHECKPOINT_IMMUTABLE: Checkpoints cannot be deleted"))
})

export default (mongoose.models.AuditCheckpoint ||
  mongoose.model<IAuditCheckpoint>("AuditCheckpoint", AuditCheckpointSchema)) as mongoose.Model<IAuditCheckpoint>
