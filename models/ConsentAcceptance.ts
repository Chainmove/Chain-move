import mongoose, { Document, Schema } from "mongoose"

export interface ConsentEvidence {
  sessionIdHash?: string
  walletAddressHash?: string
  signatureHash?: string
  userAgentHash?: string
  ipAddressHash?: string
  [key: string]: unknown
}

export interface ConsentRenderManifest {
  renderer: string
  renderedAt: Date
  locale: string
  jurisdiction: string
  documentSetHash: string
  documentVersionIds: string[]
  accessibilityMode?: string
  viewport?: Record<string, unknown>
  componentHashes?: Record<string, string>
}

export interface IConsentAcceptance extends Document {
  acceptanceId: string
  challengeId: string
  userId: Schema.Types.ObjectId
  role: "driver" | "investor" | "admin"
  locale: string
  jurisdiction: string
  documentVersionIds: Schema.Types.ObjectId[]
  documentSetHash: string
  intent: {
    type: "pool_investment" | "hire_purchase_contract"
    id: string
    summaryHash: string
  }
  consentHash: string
  sessionEvidence: ConsentEvidence
  walletEvidence?: ConsentEvidence
  renderManifest: ConsentRenderManifest
  acceptedAt: Date
  withdrawnAt?: Date
  withdrawalReason?: string
  grandfathered: boolean
  createdAt: Date
  updatedAt: Date
}

const ConsentAcceptanceSchema = new Schema<IConsentAcceptance>(
  {
    acceptanceId: { type: String, required: true, unique: true, trim: true },
    challengeId: { type: String, required: true, unique: true, trim: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    role: { type: String, enum: ["driver", "investor", "admin"], required: true },
    locale: { type: String, required: true, trim: true, lowercase: true },
    jurisdiction: { type: String, required: true, trim: true, uppercase: true },
    documentVersionIds: [{ type: Schema.Types.ObjectId, ref: "LegalDocumentVersion", required: true }],
    documentSetHash: { type: String, required: true, trim: true, lowercase: true, match: /^[a-f0-9]{64}$/ },
    intent: {
      type: {
        type: String,
        enum: ["pool_investment", "hire_purchase_contract"],
        required: true,
      },
      id: { type: String, required: true, trim: true },
      summaryHash: { type: String, required: true, trim: true, lowercase: true, match: /^[a-f0-9]{64}$/ },
    },
    consentHash: { type: String, required: true, unique: true, trim: true, lowercase: true, match: /^[a-f0-9]{64}$/ },
    sessionEvidence: { type: Schema.Types.Mixed, required: true },
    walletEvidence: { type: Schema.Types.Mixed },
    renderManifest: { type: Schema.Types.Mixed, required: true },
    acceptedAt: { type: Date, required: true, default: Date.now, index: true },
    withdrawnAt: { type: Date },
    withdrawalReason: { type: String, trim: true, maxlength: 500 },
    grandfathered: { type: Boolean, default: false, index: true },
  },
  { timestamps: true },
)

ConsentAcceptanceSchema.index({ userId: 1, "intent.type": 1, "intent.id": 1, acceptedAt: -1 })
ConsentAcceptanceSchema.index({ documentSetHash: 1, jurisdiction: 1 })

export default (mongoose.models.ConsentAcceptance ||
  mongoose.model<IConsentAcceptance>("ConsentAcceptance", ConsentAcceptanceSchema)) as mongoose.Model<IConsentAcceptance>
