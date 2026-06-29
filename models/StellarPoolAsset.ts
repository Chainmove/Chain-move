import mongoose, { Document, Schema } from "mongoose"
import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"

export type StellarAssetStatus = "draft" | "testnet" | "active" | "retired"

export interface IStellarPoolAsset extends Document {
  poolId: Schema.Types.ObjectId
  assetCode: string
  issuerPublicKey: string
  distributionPublicKey: string
  contractId?: string
  status: StellarAssetStatus
  network: string
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
      uppercase: true,
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

StellarPoolAssetSchema.pre("save", function (next) {
  if (this.isModified("assetCode")) {
    this.assetCode = this.assetCode.toUpperCase().trim()
  }
  if (this.isModified("issuerPublicKey")) {
    this.issuerPublicKey = normalizeStellarPublicKey(this.issuerPublicKey)
  }
  if (this.isModified("distributionPublicKey")) {
    this.distributionPublicKey = normalizeStellarPublicKey(this.distributionPublicKey)
  }
  next()
})

export default mongoose.models.StellarPoolAsset ||
  mongoose.model<IStellarPoolAsset>("StellarPoolAsset", StellarPoolAssetSchema)
