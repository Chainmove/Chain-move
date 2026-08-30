import mongoose from "mongoose"
import dbConnect from "@/lib/dbConnect"
import InvariantFinding, { IInvariantFinding } from "@/models/InvariantFinding"
import Vehicle from "@/models/Vehicle"
import Loan from "@/models/Loan"
import Investment from "@/models/Investment"
import InvestmentPool from "@/models/InvestmentPool"
import PoolInvestment from "@/models/PoolInvestment"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import User from "@/models/User"
import Transaction from "@/models/Transaction"
import AuditLog from "@/models/AuditLog"
import { transitionHirePurchaseContract } from "@/lib/services/contract-transition.service"
import { INVARIANT_CATALOG } from "./catalog"

export interface RepairPreview {
  findingId: string
  fingerprint: string
  ruleId: string
  primaryModel: string
  primaryId: string
  repairability: string
  strategy: string
  proposedChanges: Record<string, unknown>
  compensationPlan: string
}

export interface RepairResult {
  success: boolean
  findingId: string
  status: string
  appliedChanges?: Record<string, unknown>
  compensationPlan?: string
  auditLogId?: string
  error?: string
}

/**
 * Previews proposed repair changes without modifying database state.
 */
export async function previewRepair(findingId: string): Promise<RepairPreview> {
  await dbConnect()

  const finding = await InvariantFinding.findById(findingId)
  if (!finding) {
    throw new Error(`Finding ${findingId} not found`)
  }

  if (finding.repairability === "MANUAL_ONLY") {
    throw new Error(`Finding ${findingId} is marked MANUAL_ONLY and cannot be repaired automatically`)
  }

  const rule = INVARIANT_CATALOG.find((r) => r.ruleId === finding.ruleId)
  const strategy = rule?.repairStrategyId || "GENERIC_REPAIR"

  const proposedChanges: Record<string, unknown> = {}
  let compensationPlan = "No state changes to compensate"

  switch (strategy) {
    case "UNSET_ORPHANED_DRIVER_ID":
      proposedChanges.driverId = null
      compensationPlan = "Restore previous driverId on Vehicle if revert is required"
      break

    case "SYNC_VEHICLE_STATUS":
      proposedChanges.status = "Financed"
      compensationPlan = "Revert Vehicle.status to Available"
      break

    case "RECALCULATE_LOAN_STATUS":
      proposedChanges.status = "Approved"
      compensationPlan = "Revert Loan.status to previous state"
      break

    case "RECALCULATE_LOAN_FUNDING": {
      const investments = await Investment.find({ loanId: finding.primaryId, status: { $in: ["Funding", "Active", "Completed"] } }).lean()
      const total = investments.reduce((sum, inv) => sum + (inv.amount || 0), 0)
      proposedChanges.totalFunded = total
      compensationPlan = `Restore Loan.totalFunded from ${total} to previous cached value`
      break
    }

    case "RECALCULATE_POOL_FUNDING": {
      const poolInvestments = await PoolInvestment.find({ poolId: finding.primaryId, status: "CONFIRMED" }).lean()
      const raised = poolInvestments.reduce((sum, inv) => sum + (inv.amountNgn || 0), 0)
      const count = new Set(poolInvestments.map((i) => i.userId.toString())).size
      proposedChanges.currentRaisedNgn = raised
      proposedChanges.investorCount = count
      compensationPlan = `Restore InvestmentPool currentRaisedNgn to previous value`
      break
    }

    case "RECONCILE_WALLET_BALANCE": {
      const user = await User.findById(finding.primaryId).lean()
      const txs = await Transaction.find({ userId: finding.primaryId, status: "Completed" }).lean()
      let calculatedBalance = 0
      for (const tx of txs) {
        const amt = tx.amount || 0
        if (["deposit", "return", "wallet_funding"].includes(tx.type)) {
          calculatedBalance += amt
        } else if (["investment", "withdrawal", "repayment", "pool_investment", "wallet_debit", "down_payment"].includes(tx.type)) {
          calculatedBalance -= amt
        }
      }
      const diff = calculatedBalance - (user?.availableBalance || 0)
      proposedChanges.availableBalance = calculatedBalance
      proposedChanges.adjustmentTransaction = {
        type: diff >= 0 ? "wallet_funding" : "wallet_debit",
        amount: Math.abs(diff),
        description: "Data integrity automated balance reconciliation",
      }
      compensationPlan = "Post counter-adjustment transaction and revert availableBalance"
      break
    }

    case "REOPEN_OR_RECONCILE_CONTRACT":
      proposedChanges.status = "ACTIVE"
      compensationPlan = "Revert HirePurchaseContract.status to COMPLETED"
      break

    case "SYNC_LEGACY_USER_FIELDS": {
      const user = await User.findById(finding.primaryId).lean()
      const canonicalWallet = user?.walletAddress || user?.walletaddress || null
      proposedChanges.walletAddress = canonicalWallet
      proposedChanges.walletaddress = canonicalWallet
      proposedChanges.kycVerified = user?.isKycVerified ?? false
      proposedChanges.isKycVerified = user?.isKycVerified ?? false
      compensationPlan = "Revert legacy fields to original values"
      break
    }

    case "VALIDATE_STELLAR_KEY": {
      const user = await User.findById(finding.primaryId).lean()
      const rawKey = user?.stellarPublicKey || ""
      const trimmed = rawKey.trim()
      proposedChanges.stellarPublicKey = trimmed.length === 56 ? trimmed : null
      proposedChanges.stellarAccountType = trimmed.length === 56 ? (user?.stellarAccountType || "external_wallet") : "unknown"
      compensationPlan = `Restore original stellarPublicKey value`
      break
    }

    default:
      proposedChanges.note = "No specific strategy definition found"
      break
  }

  return {
    findingId: finding._id.toString(),
    fingerprint: finding.fingerprint,
    ruleId: finding.ruleId,
    primaryModel: finding.primaryModel,
    primaryId: finding.primaryId,
    repairability: finding.repairability,
    strategy,
    proposedChanges,
    compensationPlan,
  }
}

/**
 * Applies repair using a Mongoose session / transaction with rollback protection.
 */
export async function applyRepair(
  findingId: string,
  actor = "system_repair_engine",
): Promise<RepairResult> {
  await dbConnect()

  const finding = await InvariantFinding.findById(findingId)
  if (!finding) {
    throw new Error(`Finding ${findingId} not found`)
  }

  if (finding.status === "REPAIRED") {
    return {
      success: true,
      findingId,
      status: "REPAIRED",
      error: "Finding is already repaired",
    }
  }

  if (finding.repairability === "MANUAL_ONLY") {
    throw new Error(`Finding ${findingId} is marked MANUAL_ONLY and cannot be repaired automatically`)
  }

  const preview = await previewRepair(findingId)

  // Start Mongoose transaction session if replica set is available, else run atomic updates
  let session: mongoose.ClientSession | null = null;
  try {
    session = await mongoose.startSession();
    session.startTransaction();
  } catch (err) {
    // Single node MongoDB instances without replica set don't support sessions/transactions
    session = null;
  }

  try {
    const opts = session ? { session } : {}

    switch (preview.strategy) {
      case "UNSET_ORPHANED_DRIVER_ID":
        await Vehicle.findByIdAndUpdate(finding.primaryId, { $unset: { driverId: 1 } }, opts)
        break

      case "SYNC_VEHICLE_STATUS":
        await Vehicle.findByIdAndUpdate(finding.primaryId, { status: "Financed" }, opts)
        break

      case "RECALCULATE_LOAN_STATUS":
        await Loan.findByIdAndUpdate(finding.primaryId, { status: "Approved" }, opts)
        break

      case "RECALCULATE_LOAN_FUNDING": {
        const total = preview.proposedChanges.totalFunded as number
        const loan = await Loan.findById(finding.primaryId).lean()
        const requested = loan?.requestedAmount || 1
        const progress = Math.min(100, (total / requested) * 100)
        await Loan.findByIdAndUpdate(finding.primaryId, { totalFunded: total, fundingProgress: progress }, opts)
        break
      }

      case "RECALCULATE_POOL_FUNDING": {
        const raised = preview.proposedChanges.currentRaisedNgn as number
        const count = preview.proposedChanges.investorCount as number
        await InvestmentPool.findByIdAndUpdate(finding.primaryId, { currentRaisedNgn: raised, investorCount: count }, opts)
        break
      }

      case "RECONCILE_WALLET_BALANCE": {
        const newBal = preview.proposedChanges.availableBalance as number
        const adj = preview.proposedChanges.adjustmentTransaction as { type: string; amount: number; description: string }

        // Idempotency guard: if a prior attempt already posted the
        // compensating transaction but failed before the finding could be
        // marked REPAIRED, reuse it instead of double-adjusting the balance.
        const existingAdjustment = await Transaction.findOne({
          userId: finding.primaryId,
          "metadata.findingFingerprint": finding.fingerprint,
        }).session(session)

        if (adj && adj.amount > 0 && !existingAdjustment) {
          const user = await User.findById(finding.primaryId).lean()
          await Transaction.create(
            [
              {
                userId: finding.primaryId,
                userType: user?.role || "investor",
                type: adj.type,
                amount: adj.amount,
                method: "system",
                description: adj.description,
                status: "Completed",
                metadata: { findingFingerprint: finding.fingerprint },
              },
            ],
            opts,
          )
        }
        await User.findByIdAndUpdate(finding.primaryId, { availableBalance: newBal }, opts)
        break
      }

      case "REOPEN_OR_RECONCILE_CONTRACT":
        if (session) {
          await transitionHirePurchaseContract({
            contractId: String(finding.primaryId),
            targetState: "ACTIVE",
            actor: { type: "system" },
            reason: `Data-integrity repair (${finding.ruleId}): COMPLETED contract has an outstanding payable balance.`,
            session,
          })
        } else {
          // No replica set available (single-node Mongo) — transactions/version
          // checks are unavailable here, so fall back to a direct write as this
          // repair already did before the state machine existed.
          await HirePurchaseContract.findByIdAndUpdate(finding.primaryId, { status: "ACTIVE" }, opts)
        }
        break

      case "SYNC_LEGACY_USER_FIELDS": {
        const wallet = preview.proposedChanges.walletAddress
        const kyc = preview.proposedChanges.kycVerified
        await User.findByIdAndUpdate(
          finding.primaryId,
          { walletAddress: wallet, walletaddress: wallet, kycVerified: kyc, isKycVerified: kyc },
          opts,
        )
        break
      }

      case "VALIDATE_STELLAR_KEY": {
        const stellarKey = preview.proposedChanges.stellarPublicKey
        const accountType = preview.proposedChanges.stellarAccountType
        await User.findByIdAndUpdate(
          finding.primaryId,
          { stellarPublicKey: stellarKey, stellarAccountType: accountType },
          opts,
        )
        break
      }

      default:
        throw new Error(`Unsupported repair strategy: ${preview.strategy}`)
    }

    // Log audit event
    const [auditEntry] = await AuditLog.create(
      [
        {
          actorRole: "admin",
          action: `REPAIR_${finding.ruleId}`,
          targetType: finding.primaryModel,
          targetId: finding.primaryId,
          status: "success",
          metadata: { findingId, fingerprint: finding.fingerprint, strategy: preview.strategy },
        },
      ],
      opts,
    )

    // Update finding status and resolution history
    finding.status = "REPAIRED"
    finding.resolutionHistory.push({
      action: "repair",
      timestamp: new Date(),
      actor,
      status: "success",
      details: preview.proposedChanges,
      compensationPlan: preview.compensationPlan,
    })
    await finding.save(opts)

    if (session) {
      await session.commitTransaction()
      session.endSession()
    }

    return {
      success: true,
      findingId,
      status: "REPAIRED",
      appliedChanges: preview.proposedChanges,
      compensationPlan: preview.compensationPlan,
      auditLogId: auditEntry?._id?.toString(),
    }
  } catch (error: any) {
    if (session) {
      await session.abortTransaction()
      session.endSession()
    }

    finding.status = "FAILED"
    finding.resolutionHistory.push({
      action: "repair",
      timestamp: new Date(),
      actor,
      status: "failure",
      details: { error: error.message || String(error) },
      compensationPlan: preview.compensationPlan,
    })
    await finding.save()

    return {
      success: false,
      findingId,
      status: "FAILED",
      error: error.message || String(error),
    }
  }
}

/**
 * Suppresses or acknowledges a finding as a false positive with notes.
 */
export async function suppressFinding(
  findingId: string,
  reason: string,
  suppressedBy = "admin",
): Promise<IInvariantFinding> {
  await dbConnect()

  const finding = await InvariantFinding.findById(findingId)
  if (!finding) {
    throw new Error(`Finding ${findingId} not found`)
  }

  finding.status = "SUPPRESSED"
  finding.suppressionReason = reason
  finding.suppressedBy = suppressedBy
  finding.suppressedAt = new Date()
  finding.resolutionHistory.push({
    action: "suppress",
    timestamp: new Date(),
    actor: suppressedBy,
    status: "success",
    details: { reason },
  })

  await finding.save()
  return finding
}
