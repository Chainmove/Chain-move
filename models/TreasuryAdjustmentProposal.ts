import mongoose, { Schema } from "mongoose"

const TreasuryAdjustmentProposalSchema = new Schema(
  {
    bucket: { type: String, required: true },
    amountMinor: { type: Number, required: true },
    currency: { type: String, required: true },
    reason: { type: String, required: true, trim: true },
    proposedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
    status: { type: String, enum: ["proposed", "rejected"], default: "proposed" },
    history: { type: [{ action: String, actorId: Schema.Types.ObjectId, reason: String, timestamp: Date }], default: [] },
  },
  { timestamps: true },
)
export default (mongoose.models.TreasuryAdjustmentProposal || mongoose.model("TreasuryAdjustmentProposal", TreasuryAdjustmentProposalSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>
