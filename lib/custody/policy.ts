import { isValidStellarPublicKey, normalizeStellarPublicKey } from "@/lib/validation/stellar"
import type { OperationCategory, SignerDescriptor, SignerRole } from "./types"

export interface ThresholdPolicy {
  category: OperationCategory
  minSigners: number
  minThreshold: number
  eligibleRoles: SignerRole[]
  minDistinctRoles: number
  maxApprovalWindowMs: number
  requireDestinationAllowlist?: boolean
}

// Defaults mirror docs/stellar-asset-and-soroban-design.md (issuer multisig
// 2-of-3 or 3-of-5, rotated hot distribution signer, governance/multisig
// treasury actions). These are policy defaults, not secrets - the effective
// signers/threshold for a deployment live in the DB-persisted
// CustodySignerSet document, never in env vars or lib/stellar/config.ts.
export const DEFAULT_THRESHOLD_POLICIES: Record<OperationCategory, ThresholdPolicy> = {
  issuance: {
    category: "issuance",
    minSigners: 3,
    minThreshold: 2,
    eligibleRoles: ["issuer"],
    minDistinctRoles: 1,
    maxApprovalWindowMs: 30 * 60 * 1000,
  },
  payout: {
    category: "payout",
    minSigners: 2,
    minThreshold: 2,
    eligibleRoles: ["distribution"],
    minDistinctRoles: 1,
    maxApprovalWindowMs: 15 * 60 * 1000,
    requireDestinationAllowlist: true,
  },
  emergency: {
    category: "emergency",
    minSigners: 2,
    minThreshold: 1,
    eligibleRoles: ["security", "issuer"],
    minDistinctRoles: 1,
    maxApprovalWindowMs: 10 * 60 * 1000,
  },
  recovery: {
    category: "recovery",
    minSigners: 5,
    minThreshold: 3,
    eligibleRoles: ["recovery"],
    minDistinctRoles: 1,
    maxApprovalWindowMs: 60 * 60 * 1000,
  },
  rotation: {
    category: "rotation",
    minSigners: 3,
    minThreshold: 2,
    eligibleRoles: ["issuer", "distribution", "security"],
    minDistinctRoles: 2,
    maxApprovalWindowMs: 60 * 60 * 1000,
  },
}

export function getThresholdPolicy(category: OperationCategory): ThresholdPolicy {
  return DEFAULT_THRESHOLD_POLICIES[category]
}

export class SignerSetInvariantError extends Error {}

// Guards against the two ways a Stellar-style weighted threshold can be
// misconfigured into a permanent lockout: a threshold higher than the
// signer weights can ever reach, or too few eligible/distinct-role signers
// to ever satisfy separation of duties for this category.
export function validateSignerSetInvariants(input: {
  category: OperationCategory
  signers: SignerDescriptor[]
  threshold: number
}): void {
  const policy = getThresholdPolicy(input.category)
  const { signers, threshold } = input

  if (signers.length === 0) {
    throw new SignerSetInvariantError("Signer set must include at least one signer")
  }

  const signerIds = new Set<string>()
  const publicKeys = new Set<string>()
  let totalWeight = 0

  for (const signer of signers) {
    if (signerIds.has(signer.signerId)) {
      throw new SignerSetInvariantError(`Duplicate signerId: ${signer.signerId}`)
    }
    signerIds.add(signer.signerId)

    const normalizedKey = normalizeStellarPublicKey(signer.publicKey)
    if (!isValidStellarPublicKey(normalizedKey)) {
      throw new SignerSetInvariantError(`Invalid signer public key for ${signer.signerId}`)
    }
    if (publicKeys.has(normalizedKey)) {
      throw new SignerSetInvariantError(`Duplicate signer public key: ${normalizedKey}`)
    }
    publicKeys.add(normalizedKey)

    if (!Number.isInteger(signer.weight) || signer.weight <= 0) {
      throw new SignerSetInvariantError(`Signer weight must be a positive integer for ${signer.signerId}`)
    }
    totalWeight += signer.weight
  }

  if (!Number.isInteger(threshold) || threshold <= 0) {
    throw new SignerSetInvariantError("Threshold must be a positive integer")
  }
  if (threshold > totalWeight) {
    throw new SignerSetInvariantError(
      `Threshold (${threshold}) exceeds total signer weight (${totalWeight}); this would permanently lock the account`,
    )
  }
  if (signers.length < policy.minSigners) {
    throw new SignerSetInvariantError(`${input.category} requires at least ${policy.minSigners} signers`)
  }
  if (threshold < policy.minThreshold) {
    throw new SignerSetInvariantError(`${input.category} requires a threshold of at least ${policy.minThreshold}`)
  }

  const eligibleCount = signers.filter((signer) => policy.eligibleRoles.includes(signer.role)).length
  if (eligibleCount < policy.minThreshold) {
    throw new SignerSetInvariantError(
      `${input.category} requires at least ${policy.minThreshold} signers with an eligible role (${policy.eligibleRoles.join(", ")})`,
    )
  }

  const distinctRoles = new Set(signers.map((signer) => signer.role))
  if (distinctRoles.size < policy.minDistinctRoles) {
    throw new SignerSetInvariantError(
      `${input.category} requires signers spanning at least ${policy.minDistinctRoles} distinct role(s)`,
    )
  }
}

// Quorum is weighted, not headcount-based, so it matches the same
// signer-weight model validateSignerSetInvariants enforces (and Stellar's
// own on-chain weighted-threshold semantics). A distinct approver who is no
// longer part of the signer set contributes no weight.
export function sumApprovedWeight(
  approvals: Array<{ signerId: string }>,
  signers: Array<{ signerId: string; weight: number }>,
): number {
  const distinctApprovers = new Set(approvals.map((approval) => approval.signerId))
  let total = 0
  for (const signerId of distinctApprovers) {
    const signer = signers.find((candidate) => candidate.signerId === signerId)
    if (signer) total += signer.weight
  }
  return total
}

export class PolicyViolationError extends Error {}

export interface PayoutLimitCheck {
  amount: string
  destination: string
  allowedDestinations: string[]
  maxAmount?: string
  dailyTotalSoFar?: string
  dailyLimit?: string
}

// Amounts are integer stroop strings (1 XLM/unit = 10,000,000 stroops) so
// limits can be compared exactly with BigInt instead of floating point.
export function assertPayoutWithinPolicy(input: PayoutLimitCheck): void {
  const destination = normalizeStellarPublicKey(input.destination)
  if (!isValidStellarPublicKey(destination)) {
    throw new PolicyViolationError("Invalid payout destination public key")
  }
  if (!input.allowedDestinations.map(normalizeStellarPublicKey).includes(destination)) {
    throw new PolicyViolationError(`Destination ${destination} is not on the payout allowlist`)
  }

  const amount = BigInt(input.amount)
  if (amount <= BigInt(0)) {
    throw new PolicyViolationError("Payout amount must be positive")
  }
  if (input.maxAmount !== undefined && amount > BigInt(input.maxAmount)) {
    throw new PolicyViolationError(`Payout amount exceeds per-operation limit of ${input.maxAmount}`)
  }
  if (input.dailyLimit !== undefined) {
    const dailyTotal = BigInt(input.dailyTotalSoFar ?? "0") + amount
    if (dailyTotal > BigInt(input.dailyLimit)) {
      throw new PolicyViolationError(`Payout would exceed daily limit of ${input.dailyLimit}`)
    }
  }
}
