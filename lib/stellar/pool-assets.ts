import mongoose from "mongoose"
import StellarPoolAsset, { type IStellarPoolAsset, type StellarAssetStatus } from "@/models/StellarPoolAsset"
import InvestmentPool, { type PoolAssetType } from "@/models/InvestmentPool"
import { getStellarConfig } from "@/lib/stellar/config"
import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"

export interface CreatePoolAssetInput {
  poolId: string
  issuerPublicKey?: string
  distributionPublicKey?: string
  contractId?: string
  status?: StellarAssetStatus
  metadata?: {
    name?: string
    description?: string
    tomlUrl?: string
    imageUrl?: string
  }
}

export interface PoolAssetSummary {
  id: string
  poolId: string
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
  createdAt: string
  updatedAt: string
}

const ASSET_CODE_MAX_LENGTH = 12
const ASSET_CODE_ALPHANUMERIC_ONLY = /^[A-Z0-9]+$/

export function generatePoolAssetCode(poolId: string, assetType: PoolAssetType): string {
  if (!poolId || typeof poolId !== "string") {
    throw new Error("Pool ID is required to generate asset code")
  }

  if (!mongoose.Types.ObjectId.isValid(poolId)) {
    throw new Error("Invalid pool ID format")
  }

  const poolIdSuffix = poolId.slice(-6).toUpperCase()
  const assetTypePrefix = assetType === "SHUTTLE" ? "SHUT" : "KEKE"
  const assetCode = `${assetTypePrefix}${poolIdSuffix}`

  if (assetCode.length > ASSET_CODE_MAX_LENGTH) {
    throw new Error(`Generated asset code exceeds maximum length of ${ASSET_CODE_MAX_LENGTH}`)
  }

  if (!ASSET_CODE_ALPHANUMERIC_ONLY.test(assetCode)) {
    throw new Error("Generated asset code contains invalid characters")
  }

  return assetCode
}

export function validateAssetCode(assetCode: string): { valid: boolean; error?: string } {
  if (!assetCode || typeof assetCode !== "string") {
    return { valid: false, error: "Asset code is required" }
  }

  const trimmed = assetCode.trim().toUpperCase()

  if (trimmed.length === 0) {
    return { valid: false, error: "Asset code cannot be empty" }
  }

  if (trimmed.length > ASSET_CODE_MAX_LENGTH) {
    return { valid: false, error: `Asset code must not exceed ${ASSET_CODE_MAX_LENGTH} characters` }
  }

  if (!ASSET_CODE_ALPHANUMERIC_ONLY.test(trimmed)) {
    return { valid: false, error: "Asset code must contain only uppercase letters and numbers" }
  }

  return { valid: true }
}

function normalizePoolAsset(asset: any): PoolAssetSummary {
  return {
    id: asset._id.toString(),
    poolId: asset.poolId.toString(),
    assetCode: asset.assetCode,
    issuerPublicKey: asset.issuerPublicKey,
    distributionPublicKey: asset.distributionPublicKey,
    contractId: asset.contractId,
    status: asset.status,
    network: asset.network,
    metadata: asset.metadata,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  }
}

export async function createPoolAsset(input: CreatePoolAssetInput): Promise<PoolAssetSummary> {
  const { poolId, issuerPublicKey, distributionPublicKey, contractId, status, metadata } = input

  if (!mongoose.Types.ObjectId.isValid(poolId)) {
    throw new Error("Invalid pool ID")
  }

  const pool = await InvestmentPool.findById(poolId).lean()
  if (!pool) {
    throw new Error("Pool not found")
  }

  const existingAsset = await StellarPoolAsset.findOne({ poolId }).lean()
  if (existingAsset) {
    throw new Error("Pool asset already exists for this pool")
  }

  const config = getStellarConfig()
  const assetCode = generatePoolAssetCode(poolId, pool.assetType)

  const finalIssuerKey = issuerPublicKey || config.issuerPublicKey
  const finalDistributionKey = distributionPublicKey || config.distributionPublicKey

  if (!finalIssuerKey || !isValidStellarPublicKey(normalizeStellarPublicKey(finalIssuerKey))) {
    throw new Error("Valid issuer public key is required")
  }

  if (!finalDistributionKey || !isValidStellarPublicKey(normalizeStellarPublicKey(finalDistributionKey))) {
    throw new Error("Valid distribution public key is required")
  }

  const asset = await StellarPoolAsset.create({
    poolId,
    assetCode,
    issuerPublicKey: finalIssuerKey,
    distributionPublicKey: finalDistributionKey,
    contractId: contractId || undefined,
    status: status || "draft",
    network: config.network,
    metadata: metadata || undefined,
  })

  return normalizePoolAsset(asset.toObject())
}

export async function getPoolAsset(poolId: string): Promise<PoolAssetSummary | null> {
  if (!mongoose.Types.ObjectId.isValid(poolId)) {
    throw new Error("Invalid pool ID")
  }

  const asset = await StellarPoolAsset.findOne({ poolId }).lean()
  if (!asset) {
    return null
  }

  return normalizePoolAsset(asset)
}

export async function getPoolAssetById(assetId: string): Promise<PoolAssetSummary | null> {
  if (!mongoose.Types.ObjectId.isValid(assetId)) {
    throw new Error("Invalid asset ID")
  }

  const asset = await StellarPoolAsset.findById(assetId).lean()
  if (!asset) {
    return null
  }

  return normalizePoolAsset(asset)
}

export async function updatePoolAssetStatus(
  poolId: string,
  status: StellarAssetStatus,
): Promise<PoolAssetSummary | null> {
  if (!mongoose.Types.ObjectId.isValid(poolId)) {
    throw new Error("Invalid pool ID")
  }

  const validStatuses: StellarAssetStatus[] = ["draft", "testnet", "active", "retired"]
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`)
  }

  const asset = await StellarPoolAsset.findOneAndUpdate({ poolId }, { status }, { new: true }).lean()

  if (!asset) {
    throw new Error("Pool asset not found")
  }

  return normalizePoolAsset(asset)
}

export async function listPoolAssets(filters?: {
  status?: StellarAssetStatus
  network?: string
}): Promise<PoolAssetSummary[]> {
  const query: any = {}

  if (filters?.status) {
    query.status = filters.status
  }

  if (filters?.network) {
    query.network = filters.network.toLowerCase()
  }

  const assets = await StellarPoolAsset.find(query).sort({ createdAt: -1 }).lean()

  return assets.map(normalizePoolAsset)
}
