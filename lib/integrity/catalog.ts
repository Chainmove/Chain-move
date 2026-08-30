import crypto from "crypto"
import User from "@/models/User"
import Vehicle from "@/models/Vehicle"
import Loan from "@/models/Loan"
import Investment from "@/models/Investment"
import InvestmentPool from "@/models/InvestmentPool"
import PoolInvestment from "@/models/PoolInvestment"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import DriverVirtualAccount from "@/models/DriverVirtualAccount"
import InvestorVirtualAccount from "@/models/InvestorVirtualAccount"
import Transaction from "@/models/Transaction"
import { isValidStellarPublicKey } from "@/lib/validation/stellar"
import {
  InvariantCategory,
  InvariantRepairability,
  InvariantSeverity,
} from "@/models/InvariantFinding"

export interface RawFinding {
  fingerprint: string
  ruleId: string
  severity: InvariantSeverity
  category: InvariantCategory
  primaryModel: string
  primaryId: string
  relatedModel?: string
  relatedId?: string
  explanation: string
  details?: Record<string, unknown>
  repairability: InvariantRepairability
  repairStrategyId?: string
}

export interface InvariantRule {
  ruleId: string
  name: string
  severity: InvariantSeverity
  category: InvariantCategory
  affectedModels: string[]
  explanation: string
  repairability: InvariantRepairability
  repairStrategyId?: string
  scan: () => Promise<RawFinding[]>
}

export function createFingerprint(
  ruleId: string,
  primaryModel: string,
  primaryId: string,
  relatedModel = "",
  relatedId = "",
  extraKey = "",
): string {
  const payload = `${ruleId}:${primaryModel}:${primaryId}:${relatedModel}:${relatedId}:${extraKey}`
  return crypto.createHash("sha256").update(payload).digest("hex")
}

export const INVARIANT_CATALOG: InvariantRule[] = [
  // 1. INV_ORPHANED_USER_REF
  {
    ruleId: "INV_ORPHANED_USER_REF",
    name: "Orphaned User Reference",
    severity: "HIGH",
    category: "REFERENTIAL",
    affectedModels: ["Loan", "Vehicle", "Investment", "HirePurchaseContract", "DriverVirtualAccount", "InvestorVirtualAccount"],
    explanation: "Document references a non-existent User ID.",
    repairability: "MANUAL_ONLY",
    scan: async () => {
      const findings: RawFinding[] = []
      const users = await User.find({}, { _id: 1 }).lean()
      const userIds = new Set(users.map((u) => u._id.toString()))

      // Check Loans driverId
      const loans = await Loan.find({}, { _id: 1, driverId: 1 }).lean()
      for (const loan of loans) {
        if (loan.driverId && !userIds.has(loan.driverId.toString())) {
          findings.push({
            fingerprint: createFingerprint("INV_ORPHANED_USER_REF", "Loan", loan._id.toString(), "User", loan.driverId.toString()),
            ruleId: "INV_ORPHANED_USER_REF",
            severity: "HIGH",
            category: "REFERENTIAL",
            primaryModel: "Loan",
            primaryId: loan._id.toString(),
            relatedModel: "User",
            relatedId: loan.driverId.toString(),
            explanation: `Loan ${loan._id} references missing driver User ${loan.driverId}`,
            details: { field: "driverId" },
            repairability: "MANUAL_ONLY",
          })
        }
      }

      // Check Vehicles driverId
      const vehicles = await Vehicle.find({ driverId: { $ne: null } }, { _id: 1, driverId: 1 }).lean()
      for (const v of vehicles) {
        if (v.driverId && !userIds.has(v.driverId.toString())) {
          findings.push({
            fingerprint: createFingerprint("INV_ORPHANED_USER_REF", "Vehicle", v._id.toString(), "User", v.driverId.toString()),
            ruleId: "INV_ORPHANED_USER_REF",
            severity: "HIGH",
            category: "REFERENTIAL",
            primaryModel: "Vehicle",
            primaryId: v._id.toString(),
            relatedModel: "User",
            relatedId: v.driverId.toString(),
            explanation: `Vehicle ${v._id} references missing driver User ${v.driverId}`,
            details: { field: "driverId" },
            repairability: "AUTOMATIC",
            repairStrategyId: "UNSET_ORPHANED_DRIVER_ID",
          })
        }
      }

      // Check Contracts driverUserId
      const contracts = await HirePurchaseContract.find({}, { _id: 1, driverUserId: 1 }).lean()
      for (const c of contracts) {
        if (c.driverUserId && !userIds.has(c.driverUserId.toString())) {
          findings.push({
            fingerprint: createFingerprint("INV_ORPHANED_USER_REF", "HirePurchaseContract", c._id.toString(), "User", c.driverUserId.toString()),
            ruleId: "INV_ORPHANED_USER_REF",
            severity: "HIGH",
            category: "REFERENTIAL",
            primaryModel: "HirePurchaseContract",
            primaryId: c._id.toString(),
            relatedModel: "User",
            relatedId: c.driverUserId.toString(),
            explanation: `HirePurchaseContract ${c._id} references missing driver User ${c.driverUserId}`,
            details: { field: "driverUserId" },
            repairability: "MANUAL_ONLY",
          })
        }
      }

      return findings
    },
  },

  // 2. INV_ORPHANED_VEHICLE_REF
  {
    ruleId: "INV_ORPHANED_VEHICLE_REF",
    name: "Orphaned Vehicle Reference",
    severity: "HIGH",
    category: "REFERENTIAL",
    affectedModels: ["Loan", "Investment"],
    explanation: "Loan or Investment references a non-existent Vehicle ID.",
    repairability: "MANUAL_ONLY",
    scan: async () => {
      const findings: RawFinding[] = []
      const vehicles = await Vehicle.find({}, { _id: 1 }).lean()
      const vehicleIds = new Set(vehicles.map((v) => v._id.toString()))

      const loans = await Loan.find({}, { _id: 1, vehicleId: 1 }).lean()
      for (const loan of loans) {
        if (loan.vehicleId && !vehicleIds.has(loan.vehicleId.toString())) {
          findings.push({
            fingerprint: createFingerprint("INV_ORPHANED_VEHICLE_REF", "Loan", loan._id.toString(), "Vehicle", loan.vehicleId.toString()),
            ruleId: "INV_ORPHANED_VEHICLE_REF",
            severity: "HIGH",
            category: "REFERENTIAL",
            primaryModel: "Loan",
            primaryId: loan._id.toString(),
            relatedModel: "Vehicle",
            relatedId: loan.vehicleId.toString(),
            explanation: `Loan ${loan._id} references missing Vehicle ${loan.vehicleId}`,
            details: { field: "vehicleId" },
            repairability: "MANUAL_ONLY",
          })
        }
      }

      return findings
    },
  },

  // 3. INV_ORPHANED_POOL_REF
  {
    ruleId: "INV_ORPHANED_POOL_REF",
    name: "Orphaned Pool Reference",
    severity: "HIGH",
    category: "REFERENTIAL",
    affectedModels: ["HirePurchaseContract", "PoolInvestment"],
    explanation: "Contract or PoolInvestment references a non-existent InvestmentPool ID.",
    repairability: "MANUAL_ONLY",
    scan: async () => {
      const findings: RawFinding[] = []
      const pools = await InvestmentPool.find({}, { _id: 1 }).lean()
      const poolIds = new Set(pools.map((p) => p._id.toString()))

      const contracts = await HirePurchaseContract.find({}, { _id: 1, poolId: 1 }).lean()
      for (const c of contracts) {
        if (c.poolId && !poolIds.has(c.poolId.toString())) {
          findings.push({
            fingerprint: createFingerprint("INV_ORPHANED_POOL_REF", "HirePurchaseContract", c._id.toString(), "InvestmentPool", c.poolId.toString()),
            ruleId: "INV_ORPHANED_POOL_REF",
            severity: "HIGH",
            category: "REFERENTIAL",
            primaryModel: "HirePurchaseContract",
            primaryId: c._id.toString(),
            relatedModel: "InvestmentPool",
            relatedId: c.poolId.toString(),
            explanation: `HirePurchaseContract ${c._id} references missing InvestmentPool ${c.poolId}`,
            details: { field: "poolId" },
            repairability: "MANUAL_ONLY",
          })
        }
      }

      return findings
    },
  },

  // 4. INV_MULTIPLE_ACTIVE_CONTRACTS
  {
    ruleId: "INV_MULTIPLE_ACTIVE_CONTRACTS",
    name: "Multiple Active Contracts for Driver",
    severity: "CRITICAL",
    category: "STATUS_CONTRADICTION",
    affectedModels: ["HirePurchaseContract"],
    explanation: "Driver has more than one ACTIVE contract where prohibited.",
    repairability: "MANUAL_ONLY",
    scan: async () => {
      const findings: RawFinding[] = []
      const activeContracts = await HirePurchaseContract.find({ status: "ACTIVE" }).lean()

      const driverContractMap = new Map<string, string[]>()
      for (const c of activeContracts) {
        const driverId = c.driverUserId.toString()
        const existing = driverContractMap.get(driverId) || []
        existing.push(c._id.toString())
        driverContractMap.set(driverId, existing)
      }

      for (const [driverId, contractIds] of driverContractMap.entries()) {
        if (contractIds.length > 1) {
          for (const cId of contractIds) {
            findings.push({
              fingerprint: createFingerprint("INV_MULTIPLE_ACTIVE_CONTRACTS", "HirePurchaseContract", cId, "User", driverId),
              ruleId: "INV_MULTIPLE_ACTIVE_CONTRACTS",
              severity: "CRITICAL",
              category: "STATUS_CONTRADICTION",
              primaryModel: "HirePurchaseContract",
              primaryId: cId,
              relatedModel: "User",
              relatedId: driverId,
              explanation: `Driver ${driverId} has ${contractIds.length} active contracts: ${contractIds.join(", ")}`,
              details: { activeContractIds: contractIds },
              repairability: "MANUAL_ONLY",
            })
          }
        }
      }

      return findings
    },
  },

  // 5. INV_VEHICLE_STATUS_CONTRADICTION
  {
    ruleId: "INV_VEHICLE_STATUS_CONTRADICTION",
    name: "Vehicle Status Contradiction",
    severity: "HIGH",
    category: "STATUS_CONTRADICTION",
    affectedModels: ["Vehicle", "Loan"],
    explanation: "Vehicle status does not align with loan status or driver assignment.",
    repairability: "AUTOMATIC",
    repairStrategyId: "SYNC_VEHICLE_STATUS",
    scan: async () => {
      const findings: RawFinding[] = []
      const vehicles = await Vehicle.find({}).lean()

      for (const v of vehicles) {
        const activeLoans = await Loan.find({
          vehicleId: v._id,
          status: { $in: ["Approved", "Active"] },
        }).lean()

        if (activeLoans.length > 0 && v.status === "Available") {
          findings.push({
            fingerprint: createFingerprint("INV_VEHICLE_STATUS_CONTRADICTION", "Vehicle", v._id.toString(), "Loan", activeLoans[0]._id.toString()),
            ruleId: "INV_VEHICLE_STATUS_CONTRADICTION",
            severity: "HIGH",
            category: "STATUS_CONTRADICTION",
            primaryModel: "Vehicle",
            primaryId: v._id.toString(),
            relatedModel: "Loan",
            relatedId: activeLoans[0]._id.toString(),
            explanation: `Vehicle ${v._id} status is 'Available' but has active loan ${activeLoans[0]._id}`,
            details: { currentStatus: v.status, expectedStatus: "Financed" },
            repairability: "AUTOMATIC",
            repairStrategyId: "SYNC_VEHICLE_STATUS",
          })
        }
      }

      return findings
    },
  },

  // 6. INV_LOAN_STATUS_CONTRADICTION
  {
    ruleId: "INV_LOAN_STATUS_CONTRADICTION",
    name: "Loan Status Contradiction",
    severity: "HIGH",
    category: "STATUS_CONTRADICTION",
    affectedModels: ["Loan"],
    explanation: "Loan status conflicts with funding or repayment metrics.",
    repairability: "AUTOMATIC",
    repairStrategyId: "RECALCULATE_LOAN_STATUS",
    scan: async () => {
      const findings: RawFinding[] = []
      const loans = await Loan.find({}).lean()

      for (const loan of loans) {
        if (loan.status === "Active" && (loan.totalFunded || 0) < (loan.requestedAmount || 0)) {
          findings.push({
            fingerprint: createFingerprint("INV_LOAN_STATUS_CONTRADICTION", "Loan", loan._id.toString()),
            ruleId: "INV_LOAN_STATUS_CONTRADICTION",
            severity: "HIGH",
            category: "STATUS_CONTRADICTION",
            primaryModel: "Loan",
            primaryId: loan._id.toString(),
            explanation: `Loan ${loan._id} is marked 'Active' but totalFunded (${loan.totalFunded}) is less than requestedAmount (${loan.requestedAmount})`,
            details: { status: loan.status, totalFunded: loan.totalFunded, requestedAmount: loan.requestedAmount },
            repairability: "AUTOMATIC",
            repairStrategyId: "RECALCULATE_LOAN_STATUS",
          })
        }
      }

      return findings
    },
  },

  // 7. INV_LOAN_FUNDING_TOTAL_MISMATCH
  {
    ruleId: "INV_LOAN_FUNDING_TOTAL_MISMATCH",
    name: "Loan Funding Total Mismatch",
    severity: "HIGH",
    category: "FINANCIAL_MISMATCH",
    affectedModels: ["Loan", "Investment"],
    explanation: "Loan totalFunded or fundingProgress does not match sum of active Investment records.",
    repairability: "STRATEGY_REQUIRED",
    repairStrategyId: "RECALCULATE_LOAN_FUNDING",
    scan: async () => {
      const findings: RawFinding[] = []
      const loans = await Loan.find({}).lean()

      for (const loan of loans) {
        const investments = await Investment.find({ loanId: loan._id, status: { $in: ["Funding", "Active", "Completed"] } }).lean()
        const actualTotalFunded = investments.reduce((sum, inv) => sum + (inv.amount || 0), 0)
        const expectedProgress = loan.requestedAmount ? Math.min(100, (actualTotalFunded / loan.requestedAmount) * 100) : 0

        if (Math.abs((loan.totalFunded || 0) - actualTotalFunded) > 0.01) {
          findings.push({
            fingerprint: createFingerprint("INV_LOAN_FUNDING_TOTAL_MISMATCH", "Loan", loan._id.toString()),
            ruleId: "INV_LOAN_FUNDING_TOTAL_MISMATCH",
            severity: "HIGH",
            category: "FINANCIAL_MISMATCH",
            primaryModel: "Loan",
            primaryId: loan._id.toString(),
            explanation: `Loan ${loan._id} cached totalFunded (${loan.totalFunded}) differs from actual investments sum (${actualTotalFunded})`,
            details: { cachedTotalFunded: loan.totalFunded, actualTotalFunded, expectedProgress },
            repairability: "STRATEGY_REQUIRED",
            repairStrategyId: "RECALCULATE_LOAN_FUNDING",
          })
        }
      }

      return findings
    },
  },

  // 8. INV_POOL_FUNDING_TOTAL_MISMATCH
  {
    ruleId: "INV_POOL_FUNDING_TOTAL_MISMATCH",
    name: "Pool Funding Total Mismatch",
    severity: "HIGH",
    category: "FINANCIAL_MISMATCH",
    affectedModels: ["InvestmentPool", "PoolInvestment"],
    explanation: "InvestmentPool currentRaisedNgn or investorCount does not match confirmed PoolInvestment totals.",
    repairability: "STRATEGY_REQUIRED",
    repairStrategyId: "RECALCULATE_POOL_FUNDING",
    scan: async () => {
      const findings: RawFinding[] = []
      const pools = await InvestmentPool.find({}).lean()

      for (const pool of pools) {
        const poolInvestments = await PoolInvestment.find({ poolId: pool._id, status: "CONFIRMED" }).lean()
        const actualRaised = poolInvestments.reduce((sum, inv) => sum + (inv.amountNgn || 0), 0)
        const uniqueInvestors = new Set(poolInvestments.map((inv) => inv.userId.toString())).size

        if (Math.abs((pool.currentRaisedNgn || 0) - actualRaised) > 0.01 || (pool.investorCount || 0) !== uniqueInvestors) {
          findings.push({
            fingerprint: createFingerprint("INV_POOL_FUNDING_TOTAL_MISMATCH", "InvestmentPool", pool._id.toString()),
            ruleId: "INV_POOL_FUNDING_TOTAL_MISMATCH",
            severity: "HIGH",
            category: "FINANCIAL_MISMATCH",
            primaryModel: "InvestmentPool",
            primaryId: pool._id.toString(),
            explanation: `InvestmentPool ${pool._id} raised (${pool.currentRaisedNgn}) / investorCount (${pool.investorCount}) mismatch actual (${actualRaised} / ${uniqueInvestors})`,
            details: { cachedRaised: pool.currentRaisedNgn, actualRaised, cachedCount: pool.investorCount, actualCount: uniqueInvestors },
            repairability: "STRATEGY_REQUIRED",
            repairStrategyId: "RECALCULATE_POOL_FUNDING",
          })
        }
      }

      return findings
    },
  },

  // 9. INV_WALLET_BALANCE_MISMATCH
  {
    ruleId: "INV_WALLET_BALANCE_MISMATCH",
    name: "User Wallet Balance Mismatch",
    severity: "CRITICAL",
    category: "FINANCIAL_MISMATCH",
    affectedModels: ["User", "Transaction"],
    explanation: "User availableBalance differs from net completed transactions ledger.",
    repairability: "STRATEGY_REQUIRED",
    repairStrategyId: "RECONCILE_WALLET_BALANCE",
    scan: async () => {
      const findings: RawFinding[] = []
      const users = await User.find({}).lean()

      for (const user of users) {
        const txs = await Transaction.find({ userId: user._id, status: "Completed" }).lean()
        let calculatedBalance = 0
        for (const tx of txs) {
          const amt = tx.amount || 0
          if (["deposit", "return", "wallet_funding"].includes(tx.type)) {
            calculatedBalance += amt
          } else if (["investment", "withdrawal", "repayment", "pool_investment", "wallet_debit", "down_payment"].includes(tx.type)) {
            calculatedBalance -= amt
          }
        }

        if (Math.abs((user.availableBalance || 0) - calculatedBalance) > 0.01) {
          findings.push({
            fingerprint: createFingerprint("INV_WALLET_BALANCE_MISMATCH", "User", user._id.toString()),
            ruleId: "INV_WALLET_BALANCE_MISMATCH",
            severity: "CRITICAL",
            category: "FINANCIAL_MISMATCH",
            primaryModel: "User",
            primaryId: user._id.toString(),
            explanation: `User ${user._id} availableBalance (${user.availableBalance}) differs from transaction ledger sum (${calculatedBalance})`,
            details: { cachedBalance: user.availableBalance, calculatedBalance, difference: (user.availableBalance || 0) - calculatedBalance },
            repairability: "STRATEGY_REQUIRED",
            repairStrategyId: "RECONCILE_WALLET_BALANCE",
          })
        }
      }

      return findings
    },
  },

  // 10. INV_DUPLICATE_GATEWAY_REF
  {
    ruleId: "INV_DUPLICATE_GATEWAY_REF",
    name: "Duplicate Gateway Reference",
    severity: "HIGH",
    category: "DUPLICATE_IDENTIFIER",
    affectedModels: ["Transaction", "DriverVirtualAccount", "InvestorVirtualAccount"],
    explanation: "Duplicate gateway reference or virtual account number detected across multiple documents.",
    repairability: "MANUAL_ONLY",
    scan: async () => {
      const findings: RawFinding[] = []
      
      // Check Transactions gatewayReference duplicates
      const dupRefs = await Transaction.aggregate([
        { $match: { gatewayReference: { $nin: [null, ""] } } },
        { $group: { _id: "$gatewayReference", count: { $sum: 1 }, ids: { $push: "$_id" } } },
        { $match: { count: { $gt: 1 } } },
      ])

      for (const dup of dupRefs) {
        for (const txId of dup.ids) {
          findings.push({
            fingerprint: createFingerprint("INV_DUPLICATE_GATEWAY_REF", "Transaction", txId.toString(), "", "", dup._id),
            ruleId: "INV_DUPLICATE_GATEWAY_REF",
            severity: "HIGH",
            category: "DUPLICATE_IDENTIFIER",
            primaryModel: "Transaction",
            primaryId: txId.toString(),
            explanation: `Transaction ${txId} uses duplicate gatewayReference '${dup._id}'`,
            details: { gatewayReference: dup._id, duplicateTxIds: dup.ids.map((id: any) => id.toString()) },
            repairability: "MANUAL_ONLY",
          })
        }
      }

      // Check DriverVirtualAccount accountNumber duplicates
      const dupDriverVAs = await DriverVirtualAccount.aggregate([
        { $match: { accountNumber: { $nin: [null, ""] } } },
        { $group: { _id: "$accountNumber", count: { $sum: 1 }, ids: { $push: "$_id" } } },
        { $match: { count: { $gt: 1 } } },
      ])

      for (const dup of dupDriverVAs) {
        for (const vaId of dup.ids) {
          findings.push({
            fingerprint: createFingerprint("INV_DUPLICATE_GATEWAY_REF", "DriverVirtualAccount", vaId.toString(), "", "", dup._id),
            ruleId: "INV_DUPLICATE_GATEWAY_REF",
            severity: "HIGH",
            category: "DUPLICATE_IDENTIFIER",
            primaryModel: "DriverVirtualAccount",
            primaryId: vaId.toString(),
            explanation: `DriverVirtualAccount ${vaId} uses duplicate accountNumber '${dup._id}'`,
            details: { accountNumber: dup._id, duplicateAccountIds: dup.ids.map((id: any) => id.toString()) },
            repairability: "MANUAL_ONLY",
          })
        }
      }

      return findings
    },
  },

  // 11. INV_COMPLETED_CONTRACT_BALANCE_REMAINING
  {
    ruleId: "INV_COMPLETED_CONTRACT_BALANCE_REMAINING",
    name: "Completed Contract Balance Remaining",
    severity: "HIGH",
    category: "STATUS_CONTRADICTION",
    affectedModels: ["HirePurchaseContract"],
    explanation: "HirePurchaseContract status is COMPLETED but totalPaidNgn is less than totalPayableNgn.",
    repairability: "AUTOMATIC",
    repairStrategyId: "REOPEN_OR_RECONCILE_CONTRACT",
    scan: async () => {
      const findings: RawFinding[] = []
      const completedContracts = await HirePurchaseContract.find({ status: "COMPLETED" }).lean()

      for (const c of completedContracts) {
        if ((c.totalPaidNgn || 0) < (c.totalPayableNgn || 0)) {
          findings.push({
            fingerprint: createFingerprint("INV_COMPLETED_CONTRACT_BALANCE_REMAINING", "HirePurchaseContract", c._id.toString()),
            ruleId: "INV_COMPLETED_CONTRACT_BALANCE_REMAINING",
            severity: "HIGH",
            category: "STATUS_CONTRADICTION",
            primaryModel: "HirePurchaseContract",
            primaryId: c._id.toString(),
            explanation: `Contract ${c._id} status is COMPLETED but totalPaidNgn (${c.totalPaidNgn}) < totalPayableNgn (${c.totalPayableNgn})`,
            details: { totalPaidNgn: c.totalPaidNgn, totalPayableNgn: c.totalPayableNgn, unpaidAmount: c.totalPayableNgn - c.totalPaidNgn },
            repairability: "AUTOMATIC",
            repairStrategyId: "REOPEN_OR_RECONCILE_CONTRACT",
          })
        }
      }

      return findings
    },
  },

  // 12. INV_LEGACY_FIELDS_MISMATCH
  {
    ruleId: "INV_LEGACY_FIELDS_MISMATCH",
    name: "Legacy Fields & Schema Inconsistency",
    severity: "MEDIUM",
    category: "SCHEMA_DEPRECATION",
    affectedModels: ["User"],
    explanation: "User document contains mismatched legacy walletaddress or boolean kycVerified fields.",
    repairability: "AUTOMATIC",
    repairStrategyId: "SYNC_LEGACY_USER_FIELDS",
    scan: async () => {
      const findings: RawFinding[] = []
      const users = await User.find({}).lean()

      for (const u of users) {
        const hasLegacyWallet = Boolean(u.walletaddress && u.walletaddress !== u.walletAddress)
        const hasKycMismatch = Boolean(u.isKycVerified !== u.kycVerified)

        if (hasLegacyWallet || hasKycMismatch) {
          findings.push({
            fingerprint: createFingerprint("INV_LEGACY_FIELDS_MISMATCH", "User", u._id.toString()),
            ruleId: "INV_LEGACY_FIELDS_MISMATCH",
            severity: "MEDIUM",
            category: "SCHEMA_DEPRECATION",
            primaryModel: "User",
            primaryId: u._id.toString(),
            explanation: `User ${u._id} has legacy field discrepancies (walletaddress: ${u.walletaddress}, walletAddress: ${u.walletAddress}, isKycVerified: ${u.isKycVerified}, kycVerified: ${u.kycVerified})`,
            details: { walletaddress: u.walletaddress, walletAddress: u.walletAddress, isKycVerified: u.isKycVerified, kycVerified: u.kycVerified },
            repairability: "AUTOMATIC",
            repairStrategyId: "SYNC_LEGACY_USER_FIELDS",
          })
        }
      }

      return findings
    },
  },

  // 13. INV_INVALID_STELLAR_KEYS
  {
    ruleId: "INV_INVALID_STELLAR_KEYS",
    name: "Invalid Stellar Public Key Encoding",
    severity: "HIGH",
    category: "REFERENTIAL",
    affectedModels: ["User"],
    explanation: "User document contains malformed or invalid Stellar G-key public address.",
    repairability: "AUTOMATIC",
    repairStrategyId: "VALIDATE_STELLAR_KEY",
    scan: async () => {
      const findings: RawFinding[] = []
      const users = await User.find({ stellarPublicKey: { $nin: [null, ""] } }, { _id: 1, stellarPublicKey: 1 }).lean()

      for (const u of users) {
        const key = u.stellarPublicKey
        if (key && !isValidStellarPublicKey(key)) {
          findings.push({
            fingerprint: createFingerprint("INV_INVALID_STELLAR_KEYS", "User", u._id.toString()),
            ruleId: "INV_INVALID_STELLAR_KEYS",
            severity: "HIGH",
            category: "REFERENTIAL",
            primaryModel: "User",
            primaryId: u._id.toString(),
            explanation: `User ${u._id} has invalid Stellar public key encoding: '${key}'`,
            details: { stellarPublicKey: key },
            repairability: "AUTOMATIC",
            repairStrategyId: "VALIDATE_STELLAR_KEY",
          })
        }
      }

      return findings
    },
  },
]
