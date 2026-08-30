import mongoose, { Document, Schema } from "mongoose"

export type ConsentIntentType = "pool_investment" | "hire_purchase_contract"
export type ConsentChallengeStatus = "OPEN" | "ACCEPTED" | "EXPIRED"

export interface IConsentIntent {
  type: ConsentIntentType
  id: string
  summaryHash: string
}

export interface IConsentChallenge extends Document {
  challengeId: string
  userId: Schema.Types.ObjectId
  role: "driver" | "investor" | "admin"
  locale: string
  jurisdiction: string
  documentVersionIds: Schema.Types.ObjectId[]
  documentSetHash: string
  intent: IConsentIntent
  nonce: string
  challengeHash: string
  expiresAt: Date
  status: ConsentChallengeStatus
  acceptedAt?: Date
  createdAt: Date
  updatedAt: Date
}

const ConsentIntentSchema = new Schema<IConsentIntent>(
  {
    type: { type: String, enum: ["pool_investment", "hire_purchase_contract"], required: true },
    id: { type: String, required: true, trim: true },
    summaryHash: { type: String, required: true, trim: true, lowercase: true, match: /^[a-f0-9]{64}$/ },
  },
  { _id: false },
)

const ConsentChallengeSchema = new Schema<IConsentChallenge>(
  {
    challengeId: { type: String, required: true, unique: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ["driver", "investor", "admin"], required: true },
    locale: { type: String, required: true, trim: true, lowercase: true },
    jurisdiction: { type: String, required: true, trim: true, uppercase: true },
    documentVersionIds: [{ type: Schema.Types.ObjectId, ref: "LegalDocumentVersion", required: true }],
    documentSetHash: { type: String, required: true, trim: true, lowercase: true, match: /^[a-f0-9]{64}$/ },
    intent: { type: ConsentIntentSchema, required: true },
    nonce: { type: String, required: true, trim: true },
    challengeHash: { type: String, required: true, trim: true, lowercase: true, match: /^[a-f0-9]{64}$/ },
    expiresAt: { type: Date, required: true },
    status: { type: String, enum: ["OPEN", "ACCEPTED", "EXPIRED"], required: true, default: "OPEN", index: true },
    acceptedAt: { type: Date },
  },
  { timestamps: true },
)

ConsentChallengeSchema.index({ userId: 1, "intent.type": 1, "intent.id": 1, status: 1, createdAt: -1 })
ConsentChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 * 30 })

export default (mongoose.models.ConsentChallenge ||
  mongoose.model<IConsentChallenge>("ConsentChallenge", ConsentChallengeSchema)) as mongoose.Model<IConsentChallenge>
