import mongoose, { Schema } from "mongoose"

export interface ILedgerAccount {
  _id: any
  accountType: "asset" | "liability" | "equity" | "revenue" | "expense"
  category:
    | "investor_wallet"
    | "driver_balance"
    | "pool_escrow"
    | "platform_clearing"
    | "revenue_fees"
    | "repayments_receivable"
    | "payouts_payable"
    | "adjustment"
  ownerId?: Schema.Types.ObjectId
  ownerType?: "driver" | "investor" | "admin" | "system"
  entityId?: string
  currency: string
  name: string
  isArchived: boolean
  createdAt: Date
  updatedAt: Date
  [key: string]: any
}

const LedgerAccountSchema: Schema = new Schema(
  {
    accountType: {
      type: String,
      enum: ["asset", "liability", "equity", "revenue", "expense"],
      required: true,
    },
    category: {
      type: String,
      enum: [
        "investor_wallet",
        "driver_balance",
        "pool_escrow",
        "platform_clearing",
        "revenue_fees",
        "repayments_receivable",
        "payouts_payable",
        "adjustment",
      ],
      required: true,
    },
    ownerId: { type: Schema.Types.ObjectId, ref: "User", index: true },
    ownerType: { type: String, enum: ["driver", "investor", "admin", "system"] },
    entityId: { type: String, index: true },
    currency: { type: String, required: true, default: "NGN" },
    name: { type: String, required: true },
    isArchived: { type: Boolean, default: false },
  },
  { timestamps: true }
)

LedgerAccountSchema.index({ category: 1, currency: 1, ownerId: 1 })

export default (mongoose.models.LedgerAccount ||
  mongoose.model<ILedgerAccount>("LedgerAccount", LedgerAccountSchema)) as mongoose.Model<ILedgerAccount>
