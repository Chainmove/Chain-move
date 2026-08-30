import mongoose, { Document, Schema } from "mongoose"

export type GatewayPaymentType = "wallet_funding" | "down_payment"

export interface IProcessedGatewayEvent extends Document<string> {
  _id: string
  paymentType: GatewayPaymentType
  processedVia: "verify" | "webhook"
  createdAt: Date
  updatedAt: Date
}

const ProcessedGatewayEventSchema = new Schema<IProcessedGatewayEvent>(
  {
    _id: {
      type: String,
      required: true,
      trim: true,
    },
    paymentType: {
      type: String,
      enum: ["wallet_funding", "down_payment"],
      required: true,
    },
    processedVia: {
      type: String,
      enum: ["verify", "webhook"],
      required: true,
    },
  },
  { _id: false, timestamps: true },
)

export default (mongoose.models.ProcessedGatewayEvent ||
  mongoose.model<IProcessedGatewayEvent>("ProcessedGatewayEvent", ProcessedGatewayEventSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;