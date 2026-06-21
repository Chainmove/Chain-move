import mongoose, { Document, Schema } from "mongoose"

export type IssueType = "Payment" | "KYC" | "Vehicle" | "Pool" | "Withdrawal"
export type IssueSeverity = "Low" | "Medium" | "High"
export type IssueStatus = "Open" | "In Progress" | "Resolved"

interface IIssueNote {
  body: string
  authorUserId?: Schema.Types.ObjectId
  createdAt: Date
}

export interface IIssue extends Document {
  title: string
  description?: string
  issueType: IssueType
  severity: IssueSeverity
  status: IssueStatus
  reportedByUserId?: Schema.Types.ObjectId
  reportedByLabel?: string
  notes: IIssueNote[]
  createdAt: Date
  updatedAt: Date
}

const IssueNoteSchema = new Schema<IIssueNote>(
  {
    body: {
      type: String,
      required: true,
      trim: true,
      maxlength: 1200,
    },
    authorUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
    },
    createdAt: {
      type: Date,
      default: Date.now,
    },
  },
  { _id: false },
)

const IssueSchema = new Schema<IIssue>(
  {
    title: {
      type: String,
      required: true,
      trim: true,
      maxlength: 180,
    },
    description: {
      type: String,
      trim: true,
      maxlength: 2000,
    },
    issueType: {
      type: String,
      enum: ["Payment", "KYC", "Vehicle", "Pool", "Withdrawal"],
      required: true,
      index: true,
    },
    severity: {
      type: String,
      enum: ["Low", "Medium", "High"],
      default: "Medium",
      index: true,
    },
    status: {
      type: String,
      enum: ["Open", "In Progress", "Resolved"],
      default: "Open",
      index: true,
    },
    reportedByUserId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      index: true,
    },
    reportedByLabel: {
      type: String,
      trim: true,
      maxlength: 160,
    },
    notes: {
      type: [IssueNoteSchema],
      default: [],
    },
  },
  { timestamps: true },
)

IssueSchema.index({ createdAt: -1, status: 1 })

export default (mongoose.models.Issue ||
  mongoose.model<IIssue>("Issue", IssueSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;