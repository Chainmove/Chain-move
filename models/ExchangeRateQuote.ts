import mongoose, { Document, Schema } from "mongoose"

export interface IExchangeRateQuote extends Document {
  version: number
  baseCurrency: string
  quoteCurrency: string
  direction: "direct" | "inverse"
  sourceAmountMajor: number
  sourceAmountMinor: number
  convertedAmountMajor: number
  convertedAmountMinor: number
  rate: number
  providerRate: number
  provider: string
  providerTimestamp: Date
  fetchedAt: Date
  expiresAt: Date
  markupBps: number
  spreadBps: number
  amountPolicy: "exact-source" | "max-source"
  status: "created" | "locked" | "consumed" | "expired"
  idempotencyKey?: string
  consumedAt?: Date
  consumedBy?: string
}

const ExchangeRateQuoteSchema = new Schema<IExchangeRateQuote>(
  {
    version: { type: Number, required: true, default: 1, immutable: true },
    baseCurrency: { type: String, required: true, immutable: true, index: true },
    quoteCurrency: { type: String, required: true, immutable: true, index: true },
    direction: { type: String, enum: ["direct", "inverse"], required: true, immutable: true },
    sourceAmountMajor: { type: Number, required: true, immutable: true },
    sourceAmountMinor: { type: Number, required: true, immutable: true },
    convertedAmountMajor: { type: Number, required: true, immutable: true },
    convertedAmountMinor: { type: Number, required: true, immutable: true },
    rate: { type: Number, required: true, immutable: true },
    providerRate: { type: Number, required: true, immutable: true },
    provider: { type: String, required: true, immutable: true },
    providerTimestamp: { type: Date, required: true, immutable: true },
    fetchedAt: { type: Date, required: true, immutable: true },
    expiresAt: { type: Date, required: true, immutable: true, index: true },
    markupBps: { type: Number, required: true, immutable: true },
    spreadBps: { type: Number, required: true, immutable: true },
    amountPolicy: { type: String, enum: ["exact-source", "max-source"], required: true, immutable: true },
    status: { type: String, enum: ["created", "locked", "consumed", "expired"], required: true, default: "created", index: true },
    idempotencyKey: { type: String, index: true, unique: true, sparse: true, immutable: true },
    consumedAt: { type: Date },
    consumedBy: { type: String },
  },
  { timestamps: true },
)

ExchangeRateQuoteSchema.pre("save", function validateImmutableConsumption(next) {
  if (!this.isNew && this.isModified()) {
    const modified = this.modifiedPaths().filter((path) => !["status", "consumedAt", "consumedBy", "updatedAt"].includes(path))
    if (modified.length > 0 && this.status === "consumed") {
      next(new Error("Consumed exchange-rate quotes are immutable."))
      return
    }
  }
  next()
})

export default (mongoose.models.ExchangeRateQuote ||
  mongoose.model<IExchangeRateQuote>("ExchangeRateQuote", ExchangeRateQuoteSchema)) as mongoose.Model<IExchangeRateQuote>
