import mongoose, { Document, Schema } from "mongoose"
import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"

export type StellarAssetStatus = "draft" | "testnet" | "active" | "retired"
export type StellarPoolAssetApprovalAction = "activation" | "identity_change" | "retirement"

export interface IStellarPoolAsset extends Document {
  poolId: Schema.Types.ObjectId
  assetCode: string
  issuerPublicKey: string
  distributionPublicKey: string
  contractId?: string
  status: StellarAssetStatus
  network: string
  version: number
  identityVersion: number
  activationSnapshot?: {
    poolId: string
    assetCode: string
    issuerPublicKey: string
    distributionPublicKey: string
    contractId?: string
    network: string
    metadataHash: string
    supply: string
    evidenceHash: string
    ledger: number
    verifiedAt: Date
  }
  evidence?: {
    hash: string
    ledger: number
    verifiedAt: Date
    expiresAt: Date
    details: Record<string, unknown>
  }
  approvals?: Array<{
    action: StellarPoolAssetApprovalAction
    approvedBy: string
    approvedAt: Date
    evidenceHash?: string
    version: number
  }>
  metadata?: {
    name?: string
    description?: string
    tomlUrl?: string
    imageUrl?: string
  }
  createdAt: Date
  updatedAt: Date
}

const StellarPoolAssetSchema: Schema = new Schema(
  {
    poolId: {
      type: Schema.Types.ObjectId,
      ref: "InvestmentPool",
      required: true,
      unique: true,
      index: true,
    },
    assetCode: {
      type: String,
      required: true,
      trim: true,
      minlength: 1,
      maxlength: 12,
      validate: {
        validator: function (value: string) {
          return /^[A-Z0-9]+$/.test(value)
        },
        message: "Asset code must contain only uppercase letters and numbers",
      },
    },
    issuerPublicKey: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (value: string) {
          const normalized = normalizeStellarPublicKey(value)
          return isValidStellarPublicKey(normalized)
        },
        message: "Invalid Stellar issuer public key",
      },
    },
    distributionPublicKey: {
      type: String,
      required: true,
      trim: true,
      validate: {
        validator: function (value: string) {
          const normalized = normalizeStellarPublicKey(value)
          return isValidStellarPublicKey(normalized)
        },
        message: "Invalid Stellar distribution public key",
      },
    },
    contractId: {
      type: String,
      trim: true,
      default: undefined,
    },
    status: {
      type: String,
      enum: ["draft", "testnet", "active", "retired"],
      default: "draft",
      index: true,
    },
    network: {
      type: String,
      required: true,
      default: "testnet",
      trim: true,
      lowercase: true,
    },
    version: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    identityVersion: {
      type: Number,
      required: true,
      default: 1,
      min: 1,
    },
    activationSnapshot: {
      type: {
        poolId: { type: String, required: true },
        assetCode: { type: String, required: true },
        issuerPublicKey: { type: String, required: true },
        distributionPublicKey: { type: String, required: true },
        contractId: { type: String },
        network: { type: String, required: true },
        metadataHash: { type: String, required: true },
        supply: { type: String, required: true },
        evidenceHash: { type: String, required: true },
        ledger: { type: Number, required: true },
        verifiedAt: { type: Date, required: true },
      },
      default: undefined,
      immutable: true,
    },
    evidence: {
      type: {
        hash: { type: String, required: true },
        ledger: { type: Number, required: true },
        verifiedAt: { type: Date, required: true },
        expiresAt: { type: Date, required: true },
        details: { type: Schema.Types.Mixed, required: true },
      },
      default: undefined,
    },
    approvals: {
      type: [
        {
          action: {
            type: String,
            enum: ["activation", "identity_change", "retirement"],
            required: true,
          },
          approvedBy: { type: String, required: true },
          approvedAt: { type: Date, required: true },
          evidenceHash: { type: String },
          version: { type: Number, required: true },
        },
      ],
      default: [],
    },
    metadata: {
      type: {
        name: {
          type: String,
          trim: true,
          maxlength: 100,
        },
        description: {
          type: String,
          trim: true,
          maxlength: 500,
        },
        tomlUrl: {
          type: String,
          trim: true,
        },
        imageUrl: {
          type: String,
          trim: true,
        },
      },
      default: undefined,
    },
  },
  { timestamps: true },
)

StellarPoolAssetSchema.index({ assetCode: 1, issuerPublicKey: 1 })
StellarPoolAssetSchema.index({ status: 1, network: 1 })
StellarPoolAssetSchema.index({ poolId: 1, version: 1 })

StellarPoolAssetSchema.pre<IStellarPoolAsset>("save", function (next) {
  if (this.isModified("assetCode")) {
    const assetCode = this.get("assetCode")
    if (typeof assetCode === "string") this.set("assetCode", assetCode.trim())
  }
  if (this.isModified("issuerPublicKey")) {
    const issuerPublicKey = this.get("issuerPublicKey")
    if (typeof issuerPublicKey === "string") this.set("issuerPublicKey", normalizeStellarPublicKey(issuerPublicKey))
  }
  if (this.isModified("distributionPublicKey")) {
    const distributionPublicKey = this.get("distributionPublicKey")
    if (typeof distributionPublicKey === "string") this.set("distributionPublicKey", normalizeStellarPublicKey(distributionPublicKey))
  }
  if (!this.isNew && this.status === "active") {
    const immutableFields = ["poolId", "assetCode", "issuerPublicKey", "distributionPublicKey", "contractId", "network"]
    const modifiedIdentityField = immutableFields.find((field) => this.isModified(field))
    if (modifiedIdentityField) {
      next(new Error(`ACTIVE_POOL_ASSET_IDENTITY_IMMUTABLE: ${modifiedIdentityField} requires versioned replacement`))
      return
    }
  }
  next()
})

StellarPoolAssetSchema.pre("findOneAndUpdate", async function (next) {
  const update = this.getUpdate() as Record<string, any> | undefined
  const set = (update?.$set || update || {}) as Record<string, unknown>
  const identityFields = ["poolId", "assetCode", "issuerPublicKey", "distributionPublicKey", "contractId", "network"]
  const changesIdentity = identityFields.some((field) => Object.prototype.hasOwnProperty.call(set, field))

  if (!changesIdentity) {
    next()
    return
  }

  const existing = (await this.model.findOne(this.getQuery()).select("status").lean()) as any
  if (existing?.status === "active") {
    next(new Error("ACTIVE_POOL_ASSET_IDENTITY_IMMUTABLE: use versioned replacement"))
    return
  }
  next()
})

export default mongoose.models.StellarPoolAsset ||
  mongoose.model<IStellarPoolAsset>("StellarPoolAsset", StellarPoolAssetSchema)
