import mongoose from "mongoose"
import {
  type ConsentRole,
  REQUIRED_INVESTMENT_DOCUMENTS,
  requireAcceptedConsent,
} from "@/lib/consent/financial-consent"
import InvestmentPool from "@/models/InvestmentPool"
import PoolInvestment from "@/models/PoolInvestment"
import Transaction from "@/models/Transaction"
import User from "@/models/User"

export const TOTAL_OWNERSHIP_UNITS = 1_000_000

interface OwnershipResult {
  ownershipUnits: number
  ownershipBps: number
}

interface InvestInPoolInput {
  poolId: string
  userId: string
  amountNgn: number
  txRef?: string
  consentAcceptanceId?: string
  jurisdiction?: string
  role?: ConsentRole
}

export interface InvestInPoolResult {
  poolId: string
  userId: string
  amountNgn: number
  ownershipUnits: number
  ownershipBps: number
  txRef: string
  consentAcceptanceId: string
  acceptedDocumentSetHash: string
  poolStatus: "OPEN" | "FUNDED" | "CLOSED"
  currentRaisedNgn: number
  targetAmountNgn: number
  investorCount: number
  userBalanceNgn: number
}

const TRANSACTION_RETRY_LIMIT = 1

function shouldRetryMongoTransaction(error: unknown) {
  if (!error || typeof error !== "object") return false

  const maybeMongoError = error as {
    code?: number
    codeName?: string
    errorLabels?: string[]
    message?: string
  }

  const labels = Array.isArray(maybeMongoError.errorLabels) ? maybeMongoError.errorLabels : []
  const message = typeof maybeMongoError.message === "string" ? maybeMongoError.message : ""

  return (
    maybeMongoError.code === 251 ||
    maybeMongoError.codeName === "NoSuchTransaction" ||
    labels.includes("TransientTransactionError") ||
    /does not match any in-progress transactions/i.test(message)
  )
}

export function calculateOwnership(amountNgn: number, targetAmountNgn: number): OwnershipResult {
  const ownershipUnits = Math.floor((amountNgn * TOTAL_OWNERSHIP_UNITS) / targetAmountNgn)
  const ownershipBps = Math.floor((amountNgn * 10_000) / targetAmountNgn)

  return {
    ownershipUnits: Math.max(ownershipUnits, 0),
    ownershipBps: Math.max(ownershipBps, 0),
  }
}

export async function investInPool({
  poolId,
  userId,
  amountNgn,
  txRef,
  consentAcceptanceId,
  jurisdiction = "NG",
  role = "investor",
}: InvestInPoolInput): Promise<InvestInPoolResult> {
  if (!mongoose.Types.ObjectId.isValid(poolId)) {
    throw new Error("Invalid pool ID.")
  }

  if (!mongoose.Types.ObjectId.isValid(userId)) {
    throw new Error("Invalid user ID.")
  }

  if (!Number.isFinite(amountNgn) || amountNgn <= 0) {
    throw new Error("Amount must be greater than zero.")
  }

  let attempt = 0
  const generatedTxRef = txRef || `pool_${poolId}_${Date.now()}`

  while (attempt <= TRANSACTION_RETRY_LIMIT) {
    const session = await mongoose.startSession()
    session.startTransaction()

    try {
      // Mongo transactions do not support parallel operations on the same session.
      const pool = await InvestmentPool.findById(poolId).session(session)
      const user = await User.findById(userId).session(session)

      if (!pool) throw new Error("Pool not found.")
      if (!user) throw new Error("User not found.")

      if (pool.status !== "OPEN") {
        throw new Error("This pool is not open for investment.")
      }

      if (amountNgn < pool.minContributionNgn) {
        throw new Error(`Minimum contribution is ${pool.minContributionNgn}.`)
      }

      const remainingAmountNgn = pool.targetAmountNgn - pool.currentRaisedNgn
      if (remainingAmountNgn <= 0) {
        throw new Error("This pool has already reached its target amount.")
      }

      if (amountNgn > remainingAmountNgn) {
        throw new Error(`Amount exceeds remaining target by ${amountNgn - remainingAmountNgn}.`)
      }

      if (amountNgn > (user.availableBalance || 0)) {
        throw new Error("Insufficient internal wallet balance.")
      }

      const { ownershipUnits, ownershipBps } = calculateOwnership(amountNgn, pool.targetAmountNgn)
      const effectiveTxRef = generatedTxRef
      const consent = await requireAcceptedConsent({
        userId,
        role,
        jurisdiction,
        acceptanceId: consentAcceptanceId,
        requiredDocuments: REQUIRED_INVESTMENT_DOCUMENTS,
        intent: {
          type: "pool_investment",
          id: pool._id.toString(),
          terms: {
            amountNgn,
            txRef: effectiveTxRef,
            poolId: pool._id.toString(),
            targetAmountNgn: pool.targetAmountNgn,
            jurisdiction,
          },
        },
        session,
      })

      const existingInvestment = await PoolInvestment.exists({
        poolId: pool._id,
        userId: user._id,
        status: "CONFIRMED",
      }).session(session)

      await PoolInvestment.create(
        [
          {
            poolId: pool._id,
            userId: user._id,
            amountNgn,
            ownershipUnits,
            ownershipBps,
            txRef: effectiveTxRef,
            consentAcceptanceId: consent.acceptanceId,
            acceptedDocumentSetHash: consent.documentSetHash,
            acceptedDocumentVersionIds: consent.documentVersionIds,
            status: "CONFIRMED",
          },
        ],
        { session },
      )

      user.availableBalance = Math.max((user.availableBalance || 0) - amountNgn, 0)
      user.totalInvested = (user.totalInvested || 0) + amountNgn
      await user.save({ session })

      pool.currentRaisedNgn += amountNgn
      if (!existingInvestment) {
        pool.investorCount += 1
      }
      if (pool.currentRaisedNgn >= pool.targetAmountNgn) {
        pool.status = "FUNDED"
      }
      await pool.save({ session })

      await Transaction.create(
        [
          {
            userId: user._id,
            userType: user.role || "investor",
            type: "pool_investment",
            amount: amountNgn,
            currency: "NGN",
            method: "internal_wallet",
            status: "Completed",
            description: `${pool.assetType} pool investment`,
            relatedId: pool._id.toString(),
            gatewayReference: generatedTxRef,
            metadata: {
              ownershipUnits,
              ownershipBps,
              consentAcceptanceId: consent.acceptanceId,
              acceptedDocumentSetHash: consent.documentSetHash,
            },
          },
        ],
        { session },
      )

      await session.commitTransaction()

      return {
        poolId: pool._id.toString(),
        userId: user._id.toString(),
        amountNgn,
        ownershipUnits,
        ownershipBps,
        txRef: generatedTxRef,
        consentAcceptanceId: consent.acceptanceId,
        acceptedDocumentSetHash: consent.documentSetHash,
        poolStatus: pool.status,
        currentRaisedNgn: pool.currentRaisedNgn,
        targetAmountNgn: pool.targetAmountNgn,
        investorCount: pool.investorCount,
        userBalanceNgn: user.availableBalance,
      }
    } catch (error) {
      await session.abortTransaction().catch(() => undefined)

      const canRetry = attempt < TRANSACTION_RETRY_LIMIT && shouldRetryMongoTransaction(error)
      if (canRetry) {
        attempt += 1
        continue
      }

      throw error
    } finally {
      session.endSession()
    }
  }

  throw new Error("Unable to process investment transaction.")
}
