import ReconciliationDiscrepancy from "@/models/ReconciliationDiscrepancy"
import InvariantFinding from "@/models/InvariantFinding"
import User from "@/models/User"
import {
  previewRemediation,
  remediateDiscrepancy,
  type RemediationAction,
} from "@/lib/reconciliation/reconciliationEngine"
import { previewRepair, applyRepair } from "@/lib/integrity/repairEngine"
import { logAuditEvent } from "@/lib/security/audit-log"
import { ApprovalError } from "./errors"
import type { ApprovalOperationType, IApprovalResultRef } from "@/models/ApprovalRequest"

export interface ApprovalExecutionContext {
  approverId: string
  requesterId: string
}

export interface PreparedApproval {
  command: Record<string, unknown>
  before: Record<string, unknown>
  after: Record<string, unknown>
  exempt: boolean
  evidenceRefs: string[]
}

export interface ApprovalExecutor {
  operationType: ApprovalOperationType
  targetType: string
  prepare(targetId: string, rawCommand: Record<string, unknown>): Promise<PreparedApproval>
  loadResourceVersion(targetId: string): Promise<string>
  /** Re-checks business preconditions. Called both at request creation (fail fast) and at execution time. */
  revalidate(targetId: string, command: Record<string, unknown>): Promise<void>
  execute(
    targetId: string,
    command: Record<string, unknown>,
    context: ApprovalExecutionContext,
  ): Promise<{ resultRefs: IApprovalResultRef[] }>
}

const RECONCILIATION_ACTIONS = new Set([
  "RECONCILE_CREATE_TRANSACTION",
  "RECONCILE_POST_REVERSAL",
  "RECONCILE_UPDATE_STATUS",
  "IGNORE",
])

/**
 * Configurable lower-risk exemption: marking a discrepancy as IGNORE makes no
 * financial change, so it can execute immediately. Every other action moves
 * money or mutates a ledger-linked record and always requires approval.
 */
const reconciliationRemediateExecutor: ApprovalExecutor = {
  operationType: "reconciliation.remediate",
  targetType: "reconciliation_discrepancy",

  async prepare(targetId, rawCommand) {
    const action = String(rawCommand.action || "")
    if (!RECONCILIATION_ACTIONS.has(action)) {
      throw new ApprovalError("invalid_command", "Invalid remediation action.")
    }
    const notes = typeof rawCommand.notes === "string" ? rawCommand.notes.trim() : ""

    const preview = await previewRemediation(targetId, action as RemediationAction)

    return {
      command: { action, notes },
      before: preview.before,
      after: preview.after,
      exempt: action === "IGNORE",
      evidenceRefs: [`reconciliation_discrepancy:${targetId}`],
    }
  },

  async loadResourceVersion(targetId) {
    const doc = await ReconciliationDiscrepancy.findById(targetId).select("updatedAt").lean()
    if (!doc) throw new ApprovalError("target_not_found", "Reconciliation discrepancy no longer exists.")
    return new Date(doc.updatedAt).toISOString()
  },

  async revalidate(targetId) {
    const doc = await ReconciliationDiscrepancy.findById(targetId).select("remediationStatus").lean()
    if (!doc) throw new ApprovalError("target_not_found", "Reconciliation discrepancy no longer exists.")
    if (doc.remediationStatus !== "unresolved") {
      throw new ApprovalError("business_rule_violated", `Discrepancy is already ${doc.remediationStatus}.`)
    }
  },

  async execute(targetId, command, context) {
    const action = command.action as RemediationAction
    const notes = (command.notes as string) || "Approved via maker-checker workflow"
    const updated = await remediateDiscrepancy(targetId, action, context.approverId, notes)

    const resultRefs: IApprovalResultRef[] = [{ type: "reconciliation_discrepancy", id: targetId }]
    if (updated.internalTransactionId) {
      resultRefs.push({ type: "transaction", id: updated.internalTransactionId })
    }
    if (updated.auditLogId) {
      resultRefs.push({ type: "audit_log", id: updated.auditLogId.toString() })
    }
    return { resultRefs }
  },
}

/**
 * Configurable lower-risk exemption: repair strategies that only fix
 * referential/status metadata (no balance or funding-total change) can
 * execute immediately. Anything that moves money or recalculates funding
 * totals always requires approval.
 */
const FINANCIAL_REPAIR_STRATEGIES = new Set([
  "RECONCILE_WALLET_BALANCE",
  "RECALCULATE_LOAN_FUNDING",
  "RECALCULATE_POOL_FUNDING",
  "REOPEN_OR_RECONCILE_CONTRACT",
])

const integrityRepairApplyExecutor: ApprovalExecutor = {
  operationType: "integrity.repair.apply",
  targetType: "invariant_finding",

  async prepare(targetId) {
    const preview = await previewRepair(targetId)
    return {
      command: { strategy: preview.strategy },
      before: { ruleId: preview.ruleId, repairability: preview.repairability },
      after: { proposedChanges: preview.proposedChanges, compensationPlan: preview.compensationPlan },
      exempt: !FINANCIAL_REPAIR_STRATEGIES.has(preview.strategy),
      evidenceRefs: [`invariant_finding:${targetId}`, `fingerprint:${preview.fingerprint}`],
    }
  },

  async loadResourceVersion(targetId) {
    const finding = await InvariantFinding.findById(targetId).select("updatedAt").lean()
    if (!finding) throw new ApprovalError("target_not_found", "Finding no longer exists.")
    return new Date(finding.updatedAt).toISOString()
  },

  async revalidate(targetId) {
    const finding = await InvariantFinding.findById(targetId).select("status repairability").lean()
    if (!finding) throw new ApprovalError("target_not_found", "Finding no longer exists.")
    if (finding.status === "REPAIRED") throw new ApprovalError("business_rule_violated", "Finding is already repaired.")
    if (finding.repairability === "MANUAL_ONLY") {
      throw new ApprovalError("business_rule_violated", "Finding requires manual repair.")
    }
  },

  async execute(targetId, _command, context) {
    const result = await applyRepair(targetId, context.approverId)
    if (!result.success) {
      throw new ApprovalError("execution_failed", result.error || "Repair failed.")
    }
    const resultRefs: IApprovalResultRef[] = [{ type: "invariant_finding", id: targetId }]
    if (result.auditLogId) {
      resultRefs.push({ type: "audit_log", id: result.auditLogId })
    }
    return { resultRefs }
  },
}

const VALID_ROLES = new Set(["admin", "driver", "investor"])

/** Only a change that grants or removes the "admin" tier is privilege-sensitive. */
export function isPrivilegeCrossingRoleChange(fromRole: string, toRole: string): boolean {
  return fromRole !== toRole && (fromRole === "admin" || toRole === "admin")
}

const userRoleReassignExecutor: ApprovalExecutor = {
  operationType: "user.role_reassign",
  targetType: "user",

  async prepare(targetId, rawCommand) {
    const role = String(rawCommand.role || "")
    if (!VALID_ROLES.has(role)) {
      throw new ApprovalError("invalid_command", "Invalid role.")
    }
    const user = await User.findById(targetId).select("role").lean()
    if (!user) throw new ApprovalError("target_not_found", "User no longer exists.")

    return {
      command: { role },
      before: { role: user.role },
      after: { role },
      exempt: !isPrivilegeCrossingRoleChange(user.role, role),
      evidenceRefs: [`user:${targetId}`],
    }
  },

  async loadResourceVersion(targetId) {
    const user = await User.findById(targetId).select("updatedAt").lean()
    if (!user) throw new ApprovalError("target_not_found", "User no longer exists.")
    return new Date(user.updatedAt).toISOString()
  },

  async revalidate(targetId, command) {
    const user = await User.findById(targetId).select("role").lean()
    if (!user) throw new ApprovalError("target_not_found", "User no longer exists.")
    if (user.role === "admin" && command.role !== "admin") {
      const adminCount = await User.countDocuments({ role: "admin" })
      if (adminCount <= 1) {
        throw new ApprovalError("business_rule_violated", "At least one admin account must remain active.")
      }
    }
  },

  async execute(targetId, command, context) {
    const user = await User.findById(targetId)
    if (!user) throw new ApprovalError("target_not_found", "User no longer exists.")

    const previousRole = user.role
    const nextRole = command.role as string
    user.role = nextRole
    await user.save()

    await logAuditEvent({
      actor: { _id: context.approverId as unknown as { toString(): string }, role: "admin" },
      action: "user.role_reassign",
      targetType: "user",
      targetId,
      metadata: { previousRole, newRole: nextRole, requesterId: context.requesterId },
    })

    return { resultRefs: [{ type: "user", id: targetId }] }
  },
}

const EXECUTORS: Record<ApprovalOperationType, ApprovalExecutor> = {
  "reconciliation.remediate": reconciliationRemediateExecutor,
  "integrity.repair.apply": integrityRepairApplyExecutor,
  "user.role_reassign": userRoleReassignExecutor,
}

export function getExecutor(operationType: ApprovalOperationType): ApprovalExecutor {
  const executor = EXECUTORS[operationType]
  if (!executor) throw new ApprovalError("invalid_command", `Unknown operation type: ${operationType}`)
  return executor
}
