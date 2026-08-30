import mongoose, { Schema, type Document } from "mongoose"

export interface IAuditSequence extends Document {
  partition: string
  nextSequence: number
  createdAt: Date
  updatedAt: Date
}

const AuditSequenceSchema = new Schema<IAuditSequence>(
  {
    partition: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    nextSequence: {
      type: Number,
      required: true,
      default: 0,
    },
  },
  {
    timestamps: true,
  },
)

export default (mongoose.models.AuditSequence ||
  mongoose.model<IAuditSequence>("AuditSequence", AuditSequenceSchema)) as mongoose.Model<IAuditSequence>
