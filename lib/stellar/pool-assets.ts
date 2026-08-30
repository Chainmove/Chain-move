import mongoose from "mongoose"
import crypto from "crypto"
import StellarPoolAsset, { type IStellarPoolAsset, type StellarAssetStatus } from "@/models/StellarPoolAsset"
import InvestmentPool, { type PoolAssetType } from "@/models/InvestmentPool"
import Investment from "@/models/Investment"
import Transaction from "@/models/Transaction"
import { getStellarConfig } from "@/lib/stellar/config"
import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"
import { logAuditEvent } from "@/lib/security/audit-log"

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
  version: number
  identityVersion: number
  activationSnapshot?: Record<string, unknown>
  evidence?: {
    hash: string
    ledger: number
    verifiedAt: string
    expiresAt: string
  }
  metadata?: {
    name?: string
    description?: string
    tomlUrl?: string
    imageUrl?: string
  }
  createdAt: string
  updatedAt: string
}

export interface PoolAssetLifecycleEvidence {
  network: string
  issuerPublicKey: string
  distributionPublicKey: string
  contractId?: string
  wasmHash?: string
  assetCode: string
  poolId: string
  metadataHash: string
  supply: string | number
  ledger: number
  verifiedAt: Date | string
  expiresAt?: Date | string
  flags?: {
    authorizationRequired?: boolean
    authorizationRevocable?: boolean
    clawbackEnabled?: boolean
  }
  trustline?: {
    exists: boolean
    assetCode: string
    issuerPublicKey: string
    accountId: string
  }
  poolIdentity?: {
    poolId: string
    assetType?: PoolAssetType
  }
  metadata?: Record<string, unknown>
}

export interface PoolAssetApprovalInput {
  action: "activation" | "identity_change" | "retirement"
  approvedBy: string
  evidenceHash?: string
}

export interface UpdatePoolAssetStatusOptions {
  evidence?: PoolAssetLifecycleEvidence
  approvals?: PoolAssetApprovalInput[]
  expectedVersion?: number
  actorId?: string
  requestId?: string
}

const ASSET_CODE_MAX_LENGTH = 12
const ASSET_CODE_ALPHANUMERIC_ONLY = /^[A-Z0-9]+$/
const EVIDENCE_MAX_AGE_MS = 15 * 60 * 1000
const TERMINAL_STATUSES: StellarAssetStatus[] = ["active", "retired"]
const ALLOWED_TRANSITIONS: Record<StellarAssetStatus, StellarAssetStatus[]> = {
  draft: ["testnet"],
  testnet: ["active", "retired"],
  active: ["retired"],
  retired: [],
}

export function generatePoolAssetCode(poolId: string, assetType: PoolAssetType): string {
  if (typeof poolId !== "string" || !mongoose.Types.ObjectId.isValid(poolId)) {
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
  if (typeof assetCode !== "string") {
    return { valid: false, error: "Asset code is required" }
  }

  const trimmed = assetCode.trim()

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
    version: asset.version || 0,
    identityVersion: asset.identityVersion || 1,
    activationSnapshot: asset.activationSnapshot,
    evidence: asset.evidence
      ? {
          hash: asset.evidence.hash,
          ledger: asset.evidence.ledger,
          verifiedAt: new Date(asset.evidence.verifiedAt).toISOString(),
          expiresAt: new Date(asset.evidence.expiresAt).toISOString(),
        }
      : undefined,
    metadata: asset.metadata,
    createdAt: asset.createdAt.toISOString(),
    updatedAt: asset.updatedAt.toISOString(),
  }
}

function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value)
}

export function hashPoolAssetEvidence(evidence: PoolAssetLifecycleEvidence): string {
  return crypto.createHash("sha256").update(canonicalize(evidence)).digest("hex")
}

function validateTransition(from: StellarAssetStatus, to: StellarAssetStatus) {
  if (from === to) return
  if (TERMINAL_STATUSES.includes(from) && from !== "active") {
    throw new Error(`Invalid pool asset transition: ${from} is terminal`)
  }
  if (!ALLOWED_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid pool asset transition: ${from} -> ${to}`)
  }
}

function validateApprovals(approvals: PoolAssetApprovalInput[] | undefined, action: PoolAssetApprovalInput["action"], evidenceHash?: string) {
  const matching = (approvals || []).filter((approval) => approval.action === action)
  const approvers = new Set(matching.map((approval) => approval.approvedBy).filter(Boolean))
  if (approvers.size < 2) {
    throw new Error(`Maker-checker approval required for ${action}`)
  }
  if (evidenceHash && matching.some((approval) => approval.evidenceHash && approval.evidenceHash !== evidenceHash)) {
    throw new Error(`Approval evidence hash mismatch for ${action}`)
  }
}

function verifyActivationEvidence(asset: any, pool: any, evidence: PoolAssetLifecycleEvidence) {
  const config = getStellarConfig()
  const now = Date.now()
  const verifiedAt = new Date(evidence.verifiedAt)
  const expiresAt = evidence.expiresAt ? new Date(evidence.expiresAt) : new Date(verifiedAt.getTime() + EVIDENCE_MAX_AGE_MS)

  if (Number.isNaN(verifiedAt.getTime()) || Number.isNaN(expiresAt.getTime())) {
    throw new Error("Invalid pool asset evidence timestamp")
  }
  if (verifiedAt.getTime() > now || now - verifiedAt.getTime() > EVIDENCE_MAX_AGE_MS || expiresAt.getTime() <= now) {
    throw new Error("Stale pool asset evidence")
  }
  if (evidence.network.toLowerCase() !== asset.network || evidence.network.toLowerCase() !== config.network) {
    throw new Error("Pool asset evidence network mismatch")
  }
  if (normalizeStellarPublicKey(evidence.issuerPublicKey) !== asset.issuerPublicKey) {
    throw new Error("Pool asset evidence issuer mismatch")
  }
  if (normalizeStellarPublicKey(evidence.distributionPublicKey) !== asset.distributionPublicKey) {
    throw new Error("Pool asset evidence distribution account mismatch")
  }
  if ((evidence.contractId || undefined) !== (asset.contractId || undefined)) {
    throw new Error("Pool asset evidence contract mismatch")
  }
  if (evidence.assetCode.toUpperCase() !== asset.assetCode) {
    throw new Error("Pool asset evidence asset code mismatch")
  }
  if (evidence.poolId !== asset.poolId.toString() || evidence.poolIdentity?.poolId !== asset.poolId.toString()) {
    throw new Error("Pool asset evidence pool identity mismatch")
  }
  if (evidence.poolIdentity?.assetType && evidence.poolIdentity.assetType !== pool.assetType) {
    throw new Error("Pool asset evidence pool asset type mismatch")
  }
  if (!evidence.metadataHash || !/^[a-f0-9]{64}$/i.test(evidence.metadataHash)) {
    throw new Error("Pool asset evidence metadata hash is required")
  }
  if (!evidence.ledger || evidence.ledger <= 0) {
    throw new Error("Pool asset evidence ledger is required")
  }
  if (Number(evidence.supply) <= 0) {
    throw new Error("Pool asset evidence supply must be positive")
  }
  if (!evidence.trustline?.exists || evidence.trustline.assetCode.toUpperCase() !== asset.assetCode) {
    throw new Error("Pool asset evidence trustline mismatch")
  }
  if (normalizeStellarPublicKey(evidence.trustline.issuerPublicKey) !== asset.issuerPublicKey) {
    throw new Error("Pool asset evidence trustline issuer mismatch")
  }
  if (normalizeStellarPublicKey(evidence.trustline.accountId) !== asset.distributionPublicKey) {
    throw new Error("Pool asset evidence trustline account mismatch")
  }
}

async function assertRetirementAllowed(asset: any) {
  const poolId = asset.poolId.toString()
  const [openInvestments, pendingTransactions] = await Promise.all([
    Investment.countDocuments({ loanId: asset.poolId, status: { $in: ["Funding", "Active"] } }),
    Transaction.countDocuments({
      $or: [{ relatedId: poolId }, { "metadata.poolId": poolId }, { "metadata.assetId": asset._id.toString() }],
      status: { $in: ["Pending", "Failed"] },
    }),
  ])

  if (openInvestments > 0) {
    throw new Error("Cannot retire pool asset while active positions remain")
  }
  if (pendingTransactions > 0) {
    throw new Error("Cannot retire pool asset while payouts, disputes, or claims remain unresolved")
  }
  if (asset.evidence?.details && Number((asset.evidence.details as any).supply || 0) > 0) {
    throw new Error("Cannot retire pool asset while live supply remains")
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
    version: 0,
    identityVersion: 1,
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
  options: UpdatePoolAssetStatusOptions = {},
): Promise<PoolAssetSummary | null> {
  if (!mongoose.Types.ObjectId.isValid(poolId)) {
    throw new Error("Invalid pool ID")
  }

  const validStatuses: StellarAssetStatus[] = ["draft", "testnet", "active", "retired"]
  if (!validStatuses.includes(status)) {
    throw new Error(`Invalid status. Must be one of: ${validStatuses.join(", ")}`)
  }

  const currentAsset = (await StellarPoolAsset.findOne({ poolId }).lean()) as any

  if (!currentAsset) {
    throw new Error("Pool asset not found")
  }

  validateTransition(currentAsset.status, status)

  const pool = await InvestmentPool.findById(poolId).lean()
  if (!pool) {
    throw new Error("Pool not found")
  }

  const update: Record<string, unknown> = {
    $set: { status },
    $inc: { version: 1 },
  }
  const action = status === "active" ? "activation" : status === "retired" ? "retirement" : undefined
  let evidenceHash: string | undefined

  if (status === "active") {
    if (!options.evidence) {
      throw new Error("Verified deployment evidence is required for activation")
    }
    verifyActivationEvidence(currentAsset, pool, options.evidence)
    evidenceHash = hashPoolAssetEvidence(options.evidence)
    validateApprovals(options.approvals, "activation", evidenceHash)

    ;(update.$set as Record<string, unknown>).evidence = {
      hash: evidenceHash,
      ledger: options.evidence.ledger,
      verifiedAt: new Date(options.evidence.verifiedAt),
      expiresAt: options.evidence.expiresAt
        ? new Date(options.evidence.expiresAt)
        : new Date(new Date(options.evidence.verifiedAt).getTime() + EVIDENCE_MAX_AGE_MS),
      details: {
        ...options.evidence,
        supply: String(options.evidence.supply),
      },
    }
    ;(update.$set as Record<string, unknown>).activationSnapshot = {
      poolId: currentAsset.poolId.toString(),
      assetCode: currentAsset.assetCode,
      issuerPublicKey: currentAsset.issuerPublicKey,
      distributionPublicKey: currentAsset.distributionPublicKey,
      contractId: currentAsset.contractId,
      network: currentAsset.network,
      metadataHash: options.evidence.metadataHash,
      supply: String(options.evidence.supply),
      evidenceHash,
      ledger: options.evidence.ledger,
      verifiedAt: new Date(options.evidence.verifiedAt),
    }
  }

  if (status === "retired") {
    await assertRetirementAllowed(currentAsset)
    validateApprovals(options.approvals, "retirement", currentAsset.evidence?.hash)
  }

  if (action && options.approvals) {
    update.$push = {
      approvals: {
        $each: options.approvals
          .filter((approval) => approval.action === action)
          .map((approval) => ({
            action: approval.action,
            approvedBy: approval.approvedBy,
            approvedAt: new Date(),
            evidenceHash: approval.evidenceHash || evidenceHash || currentAsset.evidence?.hash,
            version: (currentAsset.version || 0) + 1,
          })),
      },
    }
  }

  const query: Record<string, unknown> = {
    poolId,
    version: options.expectedVersion ?? currentAsset.version ?? 0,
  }

  const asset = (await StellarPoolAsset.findOneAndUpdate(query, update, { new: true, runValidators: true }).lean()) as any
  if (!asset) {
    throw new Error("Pool asset transition conflict. Reload and retry.")
  }

  await logAuditEvent({
    actor: options.actorId ? { _id: { toString: () => options.actorId || "" }, role: "admin" } : undefined,
    action: `pool_asset.${status}`,
    targetType: "stellar_pool_asset",
    targetId: asset._id.toString(),
    requestId: options.requestId,
    metadata: {
      poolId,
      fromStatus: currentAsset.status,
      toStatus: status,
      version: asset.version,
      evidenceHash,
    },
    criticalAction: true,
  })

  return normalizePoolAsset(asset)
}

export async function replacePoolAssetIdentity(input: {
  poolId: string
  issuerPublicKey: string
  distributionPublicKey: string
  contractId?: string
  metadata?: CreatePoolAssetInput["metadata"]
  approvals: PoolAssetApprovalInput[]
  expectedVersion: number
  actorId?: string
  requestId?: string
}): Promise<PoolAssetSummary> {
  if (!mongoose.Types.ObjectId.isValid(input.poolId)) {
    throw new Error("Invalid pool ID")
  }

  const currentAsset = (await StellarPoolAsset.findOne({ poolId: input.poolId }).lean()) as any
  if (!currentAsset) {
    throw new Error("Pool asset not found")
  }
  if (currentAsset.status === "active") {
    throw new Error("Active pool asset identity is immutable; create a versioned replacement from testnet or draft")
  }
  if (currentAsset.status === "retired") {
    throw new Error("Retired pool asset identity is terminal")
  }

  validateApprovals(input.approvals, "identity_change")

  const issuerPublicKey = normalizeStellarPublicKey(input.issuerPublicKey)
  const distributionPublicKey = normalizeStellarPublicKey(input.distributionPublicKey)
  if (!isValidStellarPublicKey(issuerPublicKey)) {
    throw new Error("Valid issuer public key is required")
  }
  if (!isValidStellarPublicKey(distributionPublicKey)) {
    throw new Error("Valid distribution public key is required")
  }

  const asset = (await StellarPoolAsset.findOneAndUpdate(
    { poolId: input.poolId, version: input.expectedVersion },
    {
      $set: {
        issuerPublicKey,
        distributionPublicKey,
        contractId: input.contractId || undefined,
        metadata: input.metadata || currentAsset.metadata,
        evidence: undefined,
        activationSnapshot: undefined,
      },
      $inc: { version: 1, identityVersion: 1 },
      $push: {
        approvals: {
          $each: input.approvals
            .filter((approval) => approval.action === "identity_change")
            .map((approval) => ({
              action: approval.action,
              approvedBy: approval.approvedBy,
              approvedAt: new Date(),
              version: (currentAsset.version || 0) + 1,
            })),
        },
      },
    },
    { new: true, runValidators: true },
  ).lean()) as any

  if (!asset) {
    throw new Error("Pool asset identity change conflict. Reload and retry.")
  }

  await logAuditEvent({
    actor: input.actorId ? { _id: { toString: () => input.actorId || "" }, role: "admin" } : undefined,
    action: "pool_asset.identity_change",
    targetType: "stellar_pool_asset",
    targetId: asset._id.toString(),
    requestId: input.requestId,
    metadata: {
      poolId: input.poolId,
      version: asset.version,
      identityVersion: asset.identityVersion,
    },
    criticalAction: true,
  })

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
