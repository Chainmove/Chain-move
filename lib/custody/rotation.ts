import dbConnect from "@/lib/dbConnect"
import CustodySignerSet, { type CustodyQuorumType } from "@/models/CustodySignerSet"
import CustodyApprovalRequest from "@/models/CustodyApprovalRequest"
import { logAuditEvent } from "@/lib/security/audit-log"
import { validateSignerSetInvariants, sumApprovedWeight } from "./policy"
import type { OperationCategory, SignerDescriptor, SignerRole } from "./types"

export class RotationError extends Error {}

// Rotations (and, via the recovery quorum type, lost-signer/compromise
// recovery) are always approved by the "rotation" or "recovery" category's
// own currently active signer set - never by the category being rotated,
// and never by an unvetted caller-supplied identity. This is what makes
// approveRotation safe: an attacker cannot fabricate approvedBy identities
// to satisfy quorum, because every approval is checked against real,
// currently-authorized signers.
async function resolveGoverningSignerSet(network: string, quorumType: CustodyQuorumType) {
  const governingCategory: OperationCategory = quorumType === "recovery" ? "recovery" : "rotation"
  const governingSet = (await CustodySignerSet.findOne({
    category: governingCategory,
    network,
    status: "active",
  }).lean()) as any
  if (!governingSet) {
    throw new RotationError(
      `No active ${governingCategory} signer set is configured for ${network}; seed one with seedGenesisSignerSet before any rotation can be approved`,
    )
  }
  return governingSet
}

export interface ProposeRotationInput {
  category: OperationCategory
  network: string
  signers: SignerDescriptor[]
  threshold: number
  overlapWindowMs?: number
  createdBy: string
  requestId?: string
}

// Off-chain control-plane rotation: proposes a new authorized signer set for
// a category. This does not itself change any on-chain Stellar account -
// executing the equivalent on-chain setOptions change (if required) is a
// normal custody operation submitted through lib/custody/service.ts using
// the "rotation" category's currently active signer set for authorization.
export async function proposeRotation(input: ProposeRotationInput) {
  await dbConnect()
  validateSignerSetInvariants({ category: input.category, signers: input.signers, threshold: input.threshold })

  const network = input.network.toLowerCase()
  const current = (await CustodySignerSet.findOne({ category: input.category, network, status: "active" })
    .sort({ version: -1 })
    .lean()) as any
  const pendingExisting = await CustodySignerSet.findOne({ category: input.category, network, status: "pending" }).lean()
  if (pendingExisting) {
    throw new RotationError("A rotation is already pending for this category/network")
  }

  const version = (current?.version ?? 0) + 1
  const signerSet = await CustodySignerSet.create({
    category: input.category,
    network,
    version,
    previousVersion: current?.version,
    status: "pending",
    signers: input.signers,
    threshold: input.threshold,
    overlapWindowMs: input.overlapWindowMs ?? 24 * 60 * 60 * 1000,
    rotationApprovals: [],
    createdBy: input.createdBy,
    requestId: input.requestId,
  })

  await logAuditEvent({
    action: "custody.rotation.proposed",
    targetType: "custody_signer_set",
    targetId: signerSet._id.toString(),
    requestId: input.requestId,
    metadata: { category: input.category, network, version, threshold: input.threshold, signerCount: input.signers.length },
    criticalAction: true,
  })

  return signerSet.toObject()
}

export interface ApproveRotationInput {
  signerSetId: string
  approvedBy: string
  role: SignerRole
  quorumType: CustodyQuorumType
  requestId?: string
}

// quorumType "recovery" is the lost-signer/compromise path: it is approved
// by the recovery-eligible signer pool using the recovery category's
// (larger) threshold instead of the standard rotation threshold, so a
// rotation can still proceed when the normal quorum is unavailable.
export async function approveRotation(input: ApproveRotationInput) {
  await dbConnect()
  const signerSet = (await CustodySignerSet.findById(input.signerSetId).lean()) as any
  if (!signerSet) throw new RotationError("Signer set not found")
  if (signerSet.status !== "pending") throw new RotationError(`Cannot approve rotation in status ${signerSet.status}`)

  const governingSet = await resolveGoverningSignerSet(signerSet.network, input.quorumType)
  const eligible = governingSet.signers.find((signer: any) => signer.signerId === input.approvedBy && signer.role === input.role)
  if (!eligible) {
    throw new RotationError(
      `"${input.approvedBy}" is not an eligible ${input.role} signer in the active ${governingSet.category} signer set`,
    )
  }

  const alreadyApproved = (signerSet.rotationApprovals || []).some((approval: any) => approval.approvedBy === input.approvedBy)
  if (alreadyApproved) throw new RotationError(`${input.approvedBy} has already approved this rotation`)

  const updated = (await CustodySignerSet.findOneAndUpdate(
    { _id: input.signerSetId, status: "pending" },
    {
      $push: {
        rotationApprovals: {
          approvedBy: input.approvedBy,
          role: input.role,
          quorumType: input.quorumType,
          approvedAt: new Date(),
        },
      },
    },
    { new: true, runValidators: true },
  ).lean()) as any
  if (!updated) throw new RotationError("Rotation approval conflict; reload and retry")

  await logAuditEvent({
    action: "custody.rotation.approved",
    targetType: "custody_signer_set",
    targetId: input.signerSetId,
    requestId: input.requestId,
    metadata: { approvedBy: input.approvedBy, role: input.role, quorumType: input.quorumType },
    criticalAction: true,
  })

  const approvalsOfType = (updated.rotationApprovals || [])
    .filter((approval: any) => approval.quorumType === input.quorumType)
    .map((approval: any) => ({ signerId: approval.approvedBy }))
  const approvedWeight = sumApprovedWeight(approvalsOfType, governingSet.signers)

  return { signerSet: updated, quorumMet: approvedWeight >= governingSet.threshold }
}

// Activates a pending signer set once its quorum is met. The previous
// active set (if any) moves to "retiring" with an overlap window during
// which BOTH sets remain valid for collecting approvals on in-flight
// requests - this is the overlap-safe part of rotation.
export async function activateRotation(signerSetId: string, options: { requestId?: string } = {}) {
  await dbConnect()
  const pending = (await CustodySignerSet.findById(signerSetId).lean()) as any
  if (!pending) throw new RotationError("Signer set not found")
  if (pending.status !== "pending") throw new RotationError(`Cannot activate rotation in status ${pending.status}`)

  const approvals = pending.rotationApprovals || []
  const usedQuorumType: CustodyQuorumType = approvals[0]?.quorumType === "recovery" ? "recovery" : "standard"
  const governingSet = await resolveGoverningSignerSet(pending.network, usedQuorumType)
  const approvalsOfType = approvals
    .filter((approval: any) => approval.quorumType === usedQuorumType)
    .map((approval: any) => ({ signerId: approval.approvedBy }))
  const approvedWeight = sumApprovedWeight(approvalsOfType, governingSet.signers)
  if (approvedWeight < governingSet.threshold) {
    throw new RotationError(`Rotation quorum not met: weight ${approvedWeight}/${governingSet.threshold}`)
  }

  const now = new Date()
  const activated = (await CustodySignerSet.findOneAndUpdate(
    { _id: signerSetId, status: "pending" },
    { $set: { status: "active", effectiveFrom: now } },
    { new: true, runValidators: true },
  ).lean()) as any
  if (!activated) throw new RotationError("Activation conflict; reload and retry")

  let retiring: any = null
  if (pending.previousVersion !== undefined) {
    retiring = await CustodySignerSet.findOneAndUpdate(
      { category: pending.category, network: pending.network, version: pending.previousVersion, status: "active" },
      { $set: { status: "retiring", effectiveTo: new Date(now.getTime() + pending.overlapWindowMs) } },
      { new: true, runValidators: true },
    ).lean()
  }

  await logAuditEvent({
    action: "custody.rotation.activated",
    targetType: "custody_signer_set",
    targetId: signerSetId,
    requestId: options.requestId,
    metadata: {
      category: pending.category,
      network: pending.network,
      version: pending.version,
      previousVersion: pending.previousVersion,
      overlapUntil: retiring?.effectiveTo,
      quorumType: usedQuorumType,
    },
    criticalAction: true,
  })

  return { active: activated, retiring }
}

// The sole path to a "retired" signer set. Refuses while any non-terminal
// approval request still references this set version, so continuity is
// preserved for approvals collected before rotation began - this is what
// "rotation with pending approvals" protects against.
export async function retireIfSafe(signerSetId: string, options: { requestId?: string; now?: Date } = {}) {
  await dbConnect()
  const signerSet = (await CustodySignerSet.findById(signerSetId).lean()) as any
  if (!signerSet) throw new RotationError("Signer set not found")
  if (signerSet.status !== "retiring") {
    return { retired: false, reason: `Signer set status is ${signerSet.status}, not retiring` }
  }

  const now = options.now ?? new Date()
  if (signerSet.effectiveTo && now.getTime() < new Date(signerSet.effectiveTo).getTime()) {
    return { retired: false, reason: "Overlap window has not elapsed" }
  }

  const pendingRequests = await CustodyApprovalRequest.countDocuments({
    signerSetVersion: signerSet.version,
    category: signerSet.category,
    network: signerSet.network,
    status: { $in: ["pending", "quorum_reached", "submitting"] },
  })
  if (pendingRequests > 0) {
    return { retired: false, reason: `${pendingRequests} approval request(s) still pending against this signer set` }
  }

  const retired = await CustodySignerSet.findOneAndUpdate(
    { _id: signerSetId, status: "retiring" },
    { $set: { status: "retired" } },
    { new: true, runValidators: true },
  ).lean()
  if (!retired) return { retired: false, reason: "Retirement conflict; reload and retry" }

  await logAuditEvent({
    action: "custody.rotation.retired",
    targetType: "custody_signer_set",
    targetId: signerSetId,
    requestId: options.requestId,
    metadata: { category: signerSet.category, network: signerSet.network, version: signerSet.version },
    criticalAction: true,
  })

  return { retired: true }
}

// Reachable while a rotation is still pending, or after activation but
// before retireIfSafe has fully retired the previous set (the overlap
// window). Reactivates the previous signer set so custody never loses a
// valid quorum mid-rotation.
export async function rollbackRotation(signerSetId: string, options: { reason: string; requestId?: string }) {
  await dbConnect()
  const signerSet = (await CustodySignerSet.findById(signerSetId).lean()) as any
  if (!signerSet) throw new RotationError("Signer set not found")
  if (signerSet.status !== "pending" && signerSet.status !== "active") {
    throw new RotationError(`Cannot roll back a signer set in status ${signerSet.status}`)
  }

  // Reactivate the previous set FIRST, before touching this one's status.
  // Reversing this order would risk flipping the current set to
  // "rolled_back" (terminal/immutable) and then discovering the previous
  // set already fully retired (also terminal) - leaving the category with
  // zero active signer sets and no way back through this module.
  let reactivated: any = null
  if (signerSet.status === "active" && signerSet.previousVersion !== undefined) {
    reactivated = await CustodySignerSet.findOneAndUpdate(
      { category: signerSet.category, network: signerSet.network, version: signerSet.previousVersion, status: "retiring" },
      { $set: { status: "active" }, $unset: { effectiveTo: "" } },
      { new: true, runValidators: true },
    ).lean()
    if (!reactivated) {
      throw new RotationError(
        "Cannot roll back: previous signer set is no longer retiring (already retired); rollback aborted, active set unchanged",
      )
    }
  }

  const rolledBack = (await CustodySignerSet.findOneAndUpdate(
    { _id: signerSetId, status: signerSet.status },
    { $set: { status: "rolled_back" } },
    { new: true, runValidators: true },
  ).lean()) as any
  if (!rolledBack) {
    throw new RotationError("Rollback conflict after reactivating the previous signer set; reload and retry")
  }

  await logAuditEvent({
    action: "custody.rotation.rolled_back",
    targetType: "custody_signer_set",
    targetId: signerSetId,
    requestId: options.requestId,
    metadata: { category: signerSet.category, network: signerSet.network, version: signerSet.version, reason: options.reason },
    criticalAction: true,
  })

  return { rolledBack, reactivated }
}

export interface SeedGenesisSignerSetInput {
  category: OperationCategory
  network: string
  signers: SignerDescriptor[]
  threshold: number
  overlapWindowMs?: number
  createdBy: string
  requestId?: string
  confirmationToken: string
}

const GENESIS_CONFIRMATION_TOKEN = "CONFIRM_GENESIS_SIGNER_SET"

// One-time bootstrap for a category/network that has no signer set at all
// yet (a brand new deployment). Creates the first signer set directly as
// "active", bypassing the approval quorum that proposeRotation/
// approveRotation would otherwise require - by definition there is no
// governing signer set yet to grant that approval, so this is an
// out-of-band trust-anchor decision, not a normal control-plane action.
// Requires the literal confirmationToken (same idiom as
// scripts/audit-migrate.ts's cleanupOldAuditLogs) so it cannot be invoked
// by accident, and must only be run once per category/network from an
// audited operational script - never from an automated or HTTP-reachable
// path.
export async function seedGenesisSignerSet(input: SeedGenesisSignerSetInput) {
  if (input.confirmationToken !== GENESIS_CONFIRMATION_TOKEN) {
    throw new RotationError(`Genesis seeding requires confirmationToken: "${GENESIS_CONFIRMATION_TOKEN}"`)
  }
  await dbConnect()
  validateSignerSetInvariants({ category: input.category, signers: input.signers, threshold: input.threshold })

  const network = input.network.toLowerCase()
  const existing = await CustodySignerSet.findOne({ category: input.category, network }).lean()
  if (existing) {
    throw new RotationError(`A signer set already exists for ${input.category}/${network}; use proposeRotation instead`)
  }

  const signerSet = await CustodySignerSet.create({
    category: input.category,
    network,
    version: 1,
    status: "active",
    signers: input.signers,
    threshold: input.threshold,
    overlapWindowMs: input.overlapWindowMs ?? 24 * 60 * 60 * 1000,
    rotationApprovals: [],
    effectiveFrom: new Date(),
    createdBy: input.createdBy,
    requestId: input.requestId,
  })

  await logAuditEvent({
    action: "custody.rotation.genesis_seeded",
    targetType: "custody_signer_set",
    targetId: signerSet._id.toString(),
    requestId: input.requestId,
    metadata: { category: input.category, network, threshold: input.threshold, signerCount: input.signers.length },
    criticalAction: true,
  })

  return signerSet.toObject()
}
