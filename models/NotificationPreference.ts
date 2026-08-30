import mongoose, { Schema } from "mongoose"
const ChannelSchema = new Schema({ email: { type: Boolean, default: true }, in_app: { type: Boolean, default: true } }, { _id: false })
const channels = () => ({ type: ChannelSchema, default: () => ({}) })
const schema = new Schema({ userId: { type: Schema.Types.ObjectId, ref: "User", required: true, unique: true, index: true }, locale: { type: String, default: "en-NG" }, categories: { funding: channels(), investment: channels(), repayment: channels(), kyc: channels(), payout: channels(), arrears: channels(), contract: channels() } }, { timestamps: true })
export default mongoose.models.NotificationPreference || mongoose.model("NotificationPreference", schema)
