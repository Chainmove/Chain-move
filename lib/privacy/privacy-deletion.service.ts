/**
 * Privacy deletion / anonymization pipeline.
 *
 * Walks the data map and applies the configured `deletionStrategy` per entry:
 *
 *   - `hard_delete`  → `Model.deleteMany` for the affected user.
 *   - `anonymize`    → replace personal fields with deterministic placeholders
 *                      (one-time salt per user) and zero out sensitive blobs.
 *   - `pseudonymize` → replace personal fields with a stable alias so related
 *                      records stay joinable for audit.
 *   - `retain`       → never touch the document.
 *
 * The pipeline is resumable. Each step records its `status` on the parent
 * PrivacyRequest so a partial failure can be retried without re-running
 * completed steps.
 */

import { createHash, randomBytes } from "crypto"

import dbConnect from "@/lib/dbConnect"
import AuditLog from "@/models/AuditLog"
import DriverPayment from "@/models/DriverPayment"
import DriverVirtualAccount from "@/models/DriverVirtualAccount"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import Investment from "@/models/Investment"
import InvestorCredit from "@/models/InvestorCredit"
import InvestorVirtualAccount from "@/models/InvestorVirtualAccount"
import Issue from "@/models/Issue"
import KycDocument from "@/models/KycDocument"
import Loan from "@/models/Loan"
import Notification from "@/models/Notification"
import NotificationPreference from "@/models/NotificationPreference"
import PoolInvestment from "@/models/PoolInvestment"
import Transaction from "@/models/Transaction"
import User from "@/models/User"
import Vehicle from "@/models/Vehicle"
import WalletRecovery from "@/models/WalletRecovery"

import PrivacyRequest, {
  type IPrivacyRequest,
  type IPrivacyRequestStep,
} from "@/models/PrivacyRequest"
import {
  PRIVACY_DATA_MAP,
  type PrivacyDataMapEntry,
  RETENTION_POLICY_VERSION,
} from "@/lib/privacy/data-map"
import { evaluateDeletionEligibility } from "@/lib/privacy/legal-hold.service"
import { logAuditEvent } from "@/lib/security/audit-log"

export interface DeletionOutcome {
  steps: IPrivacyRequestStep[]
  blockedBy: { holds: string[]; reasons: string[] }
}

const ANONYMIZED_PLACEHOLDER_PREFIX = "REDACTED"

function pseudonymFor(userId: string, field: string): string {
  const salt = process.env.PRIVACY_PSEUDONYM_SALT || "chainmove-privacy-salt-v1"
  const hash = createHash("sha256")
    .update(`${salt}:${userId}:${field}`)
    .digest("hex")
    .slice(0, 16)
  return `${ANONYMIZED_PLACEHOLDER_PREFIX}_${field.toUpperCase()}_${hash}`
}

function fullAnonymizeFor(userId: string): string {
  const salt = process.env.PRIVACY_PSEUDONYM_SALT || "chainmove-privacy-salt-v1"
  const hash = createHash("sha256")
    .update(`${salt}:${userId}:tombstone`)
    .digest("hex")
    .slice(0, 16)
  return `${ANONYMIZED_PLACEHOLDER_PREFIX}_USER_${hash}`
}

function newAnonymizationToken(): string {
  return `ANON_${randomBytes(8).toString("hex").toUpperCase()}`
}

type ModelDelegate = {
  deleteMany: (filter: any) => Promise<{ deletedCount?: number }>
  updateMany: (filter: any, update: any) => Promise<{ modifiedCount?: number }>
}

const MODEL_DELEGATES: Record<string, ModelDelegate> = {
  User: User as unknown as ModelDelegate,
  NotificationPreference: NotificationPreference as unknown as ModelDelegate,
  KycDocument: KycDocument as unknown as ModelDelegate,
  Vehicle: Vehicle as unknown as ModelDelegate,
  Loan: Loan as unknown as ModelDelegate,
  Investment: Investment as unknown as ModelDelegate,
  PoolInvestment: PoolInvestment as unknown as ModelDelegate,
  HirePurchaseContract: HirePurchaseContract as unknown as ModelDelegate,
  DriverPayment: DriverPayment as unknown as ModelDelegate,
  DriverVirtualAccount: DriverVirtualAccount as unknown as ModelDelegate,
  InvestorVirtualAccount: InvestorVirtualAccount as unknown as ModelDelegate,
  InvestorCredit: InvestorCredit as unknown as ModelDelegate,
  Transaction: Transaction as unknown as ModelDelegate,
  Notification: Notification as unknown as ModelDelegate,
  Issue: Issue as unknown as ModelDelegate,
  WalletRecovery: WalletRecovery as unknown as ModelDelegate,
  AuditLog: AuditLog as unknown as ModelDelegate,
}

/**
 * Returns the list of resource references that will be touched by the
 * deletion pipeline for a given user. Used by the legal-hold evaluation.
 */
export async function collectDeletionResourceRefs(userId: string): Promise<
  { resourceType: "user" | "kyc_document" | "wallet" | "contract" | "investment" | "transaction" | "loan" | "vehicle" | "audit_record"; resourceId: string }[]
> {
  const refs: { resourceType: any; resourceId: string }[] = []
  refs.push({ resourceType: "user", resourceId: userId })

  const [kycDocs, contracts, investments, transactions] = await Promise.all([
    KycDocument.find({ userId }, { _id: 1 }).lean(),
    HirePurchaseContract.find({ driverUserId: userId }, { _id: 1 }).lean(),
    Investment.find({ investorId: userId }, { _id: 1 }).lean(),
    Transaction.find({ userId }, { _id: 1 }).lean(),
  ])

  for (const doc of kycDocs) refs.push({ resourceType: "kyc_document", resourceId: doc._id.toString() })
  for (const c of contracts) refs.push({ resourceType: "contract", resourceId: c._id.toString() })
  for (const inv of investments) refs.push({ resourceType: "investment", resourceId: inv._id.toString() })
  for (const t of transactions) refs.push({ resourceType: "transaction", resourceId: t._id.toString() })
  return refs
}

export async function getDeletionStepsForUser(userId: string): Promise<PrivacyDataMapEntry[]> {
  return PRIVACY_DATA_MAP
}

/**
 * Applies a single deletion strategy against a model entry.
 * Returns the number of affected documents.
 */
async function applyEntry(
  entry: PrivacyDataMapEntry,
  userId: string,
  stepLabel: string,
): Promise<{ affectedCount: number; skippedReason?: string }> {
  const model = MODEL_DELEGATES[entry.model]
  if (!model) {
    return { affectedCount: 0, skippedReason: `Unknown model: ${entry.model}` }
  }

  const filter: any = { [entry.ownerField]: userId }

  if (entry.deletionStrategy === "hard_delete") {
    const result = await model.deleteMany(filter)
    return { affectedCount: result.deletedCount || 0 }
  }

  if (entry.deletionStrategy === "anonymize" || entry.deletionStrategy === "pseudonymize") {
    const update: Record<string, unknown> = {}
    const unset: Record<string, unknown> = {}
    for (const field of entry.personalFields) {
      if (entry.model === "User" && (field === "name" || field === "fullName")) {
        update[field] = fullAnonymizeFor(userId)
        continue
      }
      if (entry.model === "User" && (field === "password" || field === "privyUserId")) {
        // Auth credentials are nulled, not pseudonymized — there is no
        // useful tombstone value for a password hash.
        continue
      }
      if (entry.model === "User" && field === "notifications") {
        // Deprecated embedded array. Notifications live in their own
        // collection, which the "Notifications" entry hard-deletes; a
        // not-yet-migrated document may still hold notification text here, so
        // drop the field outright instead of leaving an empty array behind.
        unset[field] = ""
        continue
      }
      update[field] = pseudonymFor(userId, field)
    }
    if (entry.model === "User") {
      update.kycDocuments = []
      update.kycRejectionReason = null
      update.password = null
      update.privyUserId = null
      update.anonymizedAt = new Date()
      update.anonymizationToken = newAnonymizationToken()
    }
    if (entry.model === "AuditLog") {
      update.metadata = {
        anonymized: true,
        anonymizedAt: new Date().toISOString(),
      }
    }
    const result = await model.updateMany(
      filter,
      Object.keys(unset).length > 0 ? { $set: update, $unset: unset } : { $set: update },
    )
    return { affectedCount: result.modifiedCount || 0 }
  }

  if (entry.deletionStrategy === "retain") {
    return { affectedCount: 0, skippedReason: "Retained by policy" }
  }

  return { affectedCount: 0, skippedReason: "Unknown strategy" }
}

/**
 * Builds the initial list of steps for a deletion request. Steps are
 * appended in a deterministic order so that re-running a request produces
 * the same step sequence.
 */
export function buildDeletionSteps(entries: PrivacyDataMapEntry[]): IPrivacyRequestStep[] {
  return entries.map((entry) => ({
    stepId: `delete_${entry.model.toLowerCase()}_${entry.category}`,
    label: entry.label,
    status: "pending" as const,
  }))
}

export async function executeDeletionPipeline(
  request: IPrivacyRequest,
  options: { actor?: { id: string; role: "user" | "admin" | "system" } } = {},
): Promise<DeletionOutcome> {
  await dbConnect()

  if (request.requestType !== "DELETION") {
    throw new Error("executeDeletionPipeline called on non-deletion request")
  }

  const userId = request.userId

  // Eligibility: evaluate active holds *before* doing any destructive work.
  const resourceRefs = await collectDeletionResourceRefs(userId)
  const eligibility = await evaluateDeletionEligibility({ userId, resourceRefs })

  if (eligibility.blocked) {
    request.status = "FAILED"
    request.blockingHoldIds = eligibility.holds.map((h) => h.id)
    request.blockReason = `Blocked by ${eligibility.holds.length} active legal hold(s).`
    request.lastError = request.blockReason
    request.auditHistory.push({
      kind: "blocked_by_hold",
      actor: options.actor?.id,
      actorType: options.actor?.role || "system",
      reason: request.blockReason,
      metadata: { holdIds: request.blockingHoldIds },
      at: new Date(),
    })
    await request.save()

    await logAuditEvent({
      actor: options.actor?.id ? { _id: options.actor.id, role: options.actor.role } : null,
      action: "privacy.deletion.blocked_by_hold",
      targetType: "PrivacyRequest",
      targetId: request.id,
      status: "failure",
      metadata: {
        userId,
        holdIds: request.blockingHoldIds,
        holdReasons: eligibility.reasons,
      },
    })

    return {
      steps: request.steps,
      blockedBy: { holds: eligibility.holds.map((h) => h.id), reasons: eligibility.reasons },
    }
  }

  const entries = PRIVACY_DATA_MAP
  if (request.steps.length === 0) {
    request.steps = buildDeletionSteps(entries)
  }
  request.status = "PROCESSING"
  request.retentionPolicyVersion = RETENTION_POLICY_VERSION
  request.auditHistory.push({
    kind: "processing_started",
    actor: options.actor?.id,
    actorType: options.actor?.role || "system",
    at: new Date(),
  })
  await request.save()

  await logAuditEvent({
    actor: options.actor?.id ? { _id: options.actor.id, role: options.actor.role } : null,
    action: "privacy.deletion.processing_started",
    targetType: "PrivacyRequest",
    targetId: request.id,
    status: "success",
    metadata: { userId, stepCount: request.steps.length },
  })

  const completedStepIds = new Set(
    request.steps.filter((s) => s.status === "completed").map((s) => s.stepId),
  )
  let processedCount = 0
  let resumed = false

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const stepId = `delete_${entry.model.toLowerCase()}_${entry.category}`
    const step = request.steps.find((s) => s.stepId === stepId)
    if (!step) continue
    if (completedStepIds.has(stepId)) continue

    step.status = "in_progress"
    step.startedAt = new Date()
    await request.save()

    try {
      const { affectedCount, skippedReason } = await applyEntry(entry, userId, step.label)
      step.status = skippedReason ? "skipped" : "completed"
      step.affectedCount = affectedCount
      step.completedAt = new Date()
      if (skippedReason) step.errorMessage = skippedReason
      processedCount += 1
      await request.save()
    } catch (error) {
      step.status = "failed"
      step.errorMessage = error instanceof Error ? error.message : String(error)
      step.completedAt = new Date()
      request.retryCount += 1
      request.lastError = step.errorMessage
      request.auditHistory.push({
        kind: "processing_failed",
        actor: options.actor?.id,
        actorType: options.actor?.role || "system",
        reason: step.errorMessage,
        metadata: { stepId },
        at: new Date(),
      })
      await request.save()

      await logAuditEvent({
        actor: options.actor?.id ? { _id: options.actor.id, role: options.actor.role } : null,
        action: "privacy.deletion.step_failed",
        targetType: "PrivacyRequest",
        targetId: request.id,
        status: "failure",
        metadata: { userId, stepId, error: step.errorMessage },
      })

      return {
        steps: request.steps,
        blockedBy: { holds: [], reasons: [] },
      }
    }
  }

  request.status = "COMPLETED"
  request.completedAt = new Date()
  request.auditHistory.push({
    kind: "processing_completed",
    actor: options.actor?.id,
    actorType: options.actor?.role || "system",
    at: new Date(),
    metadata: { processedCount, resumed },
  })
  await request.save()

  await logAuditEvent({
    actor: options.actor?.id ? { _id: options.actor.id, role: options.actor.role } : null,
    action: "privacy.deletion.completed",
    targetType: "PrivacyRequest",
    targetId: request.id,
    status: "success",
    metadata: { userId, processedCount, retentionPolicyVersion: RETENTION_POLICY_VERSION },
  })

  return {
    steps: request.steps,
    blockedBy: { holds: [], reasons: [] },
  }
}

export async function resumeDeletionPipeline(request: IPrivacyRequest): Promise<DeletionOutcome> {
  request.auditHistory.push({
    kind: "processing_resumed",
    actor: "system",
    actorType: "system",
    at: new Date(),
  })
  await request.save()
  return executeDeletionPipeline(request, { actor: { id: "system", role: "system" } })
}
