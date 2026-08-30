import mongoose, { Document, Schema } from "mongoose"

export interface ITransaction extends Document {
  userId: Schema.Types.ObjectId
  userType: "driver" | "investor" | "admin"
  type:
    | "investment"
    | "loan_disbursement"
    | "repayment"
    | "deposit"
    | "withdrawal"
    | "return"
    | "pool_investment"
    | "wallet_funding"
    | "wallet_debit"
    | "down_payment"
  amount: number
  amountOriginal?: number
  currency?: string
  originalCurrency?: string
  exchangeRate?: number
  exchangeRateQuoteId?: Schema.Types.ObjectId
  bookedQuoteSnapshot?: Record<string, unknown>
  method?: "wallet" | "internal_wallet" | "gateway" | "paystack" | "privy" | "system"
  gatewayReference?: string
  description: string
  status: "Pending" | "Completed" | "Failed"
  relatedId?: string
  metadata?: Record<string, unknown>
  timestamp: Date
}

const TransactionSchema: Schema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  userType: {
    type: String,
    enum: ["driver", "investor", "admin"],
    required: true,
  },
  type: {
    type: String,
    enum: [
      "investment",
      "loan_disbursement",
      "repayment",
      "deposit",
      "withdrawal",
      "return",
      "pool_investment",
      "wallet_funding",
      "wallet_debit",
      "down_payment",
    ],
    required: true,
  },
  amount: { type: Number, required: true },
  amountOriginal: { type: Number },
  currency: { type: String, default: "NGN" },
  originalCurrency: { type: String },
  exchangeRate: { type: Number },
  exchangeRateQuoteId: { type: Schema.Types.ObjectId, ref: "ExchangeRateQuote", index: true },
  bookedQuoteSnapshot: { type: Schema.Types.Mixed },
  method: {
    type: String,
    enum: ["wallet", "internal_wallet", "gateway", "paystack", "privy", "system"],
  },
  gatewayReference: { type: String, index: true, sparse: true },
  description: { type: String, default: "" },
  status: {
    type: String,
    enum: ["Pending", "Completed", "Failed"],
    default: "Completed",
  },
  relatedId: { type: String },
  metadata: { type: Schema.Types.Mixed },
  timestamp: { type: Date, default: Date.now },
})

TransactionSchema.index({ userId: 1, userType: 1, timestamp: -1, _id: -1 })
TransactionSchema.index({ userId: 1, type: 1, timestamp: -1, _id: -1 })

export default (mongoose.models.Transaction ||
  mongoose.model<ITransaction>("Transaction", TransactionSchema)) as mongoose.Model<{ _id: any; [key: string]: any }>;
