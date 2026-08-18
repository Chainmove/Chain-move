import mongoose, { type ClientSession } from "mongoose"

import dbConnect from "@/lib/dbConnect"
import AuditLog from "@/models/AuditLog"
import SettlementRecord, {
  CanonicalSettlementState,
  ISettlementRecord,
  OperatorTimelineEntry,
  SettlementRail,
} from "@/models/SettlementRecord"
import Transaction from "@/models/Transaction"
import User from "@/models/User"
import { getRailSettlementConfig } from "./config"
import { determineSafeActions, isValidTransition } from "./state-machine"

export interface InitiateSettlementInput {
  rail: SettlementRail
  providerReference: string
  userId: string | mongoose.Types.ObjectId
  userType: "driver" | "investor" | "admin"
  paymentType: "wallet_funding" | "down_payment" | "driver_repayment" | "pool_investment" | "payout"
  amount: number
  currency?: string
  stellarHash?: string
  ledgerJournalId?: string
  poolInvestmentId?: string
  driverPaymentId?: string
  userTransactionId?: string
  initialState?: CanonicalSettlementState
  triggeredBy?: "webhook" | "verifier" | "indexer" | "operator" | "system"
  reason?: string
  metadata?: Record<string, unknown>
}

export interface TransitionStateInput {
  settlementId?: string
  providerReference?: string
  targetState: CanonicalSettlementState
  triggeredBy: "webhook" | "verifier" | "indexer" | "operator" | "system"
  reason: string
  stellarHash?: string
  ledgerJournalId?: string
  poolInvestmentId?: string
  userTransactionId?: string
  driverPaymentId?: string
  confirmationsCount?: number
  metadata?: Record<string, unknown>
  session?: ClientSession
}

function generateSettlementId(): string {
  return `STL-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`
}

async function runInSession<T>(
  existingSession: ClientSession | undefined,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  if (existingSession) {
    return fn(existingSession)
  }
  const session = await mongoose.startSession()
  session.startTransaction()
  try {
    const res = await fn(session)
    await session.commitTransaction()
    return res
  } catch (err) {
    await session.abortTransaction().catch(() => undefined)
    throw err
  } finally {
    session.endSession()
  }
}

export async function initiateSettlement(input: InitiateSettlementInput): Promise<{
  settlement: ISettlementRecord
  alreadyExists: boolean
}> {
  await dbConnect()

  const normalizedRef = input.providerReference.trim()
  if (!normalizedRef) {
    throw new Error("Provider reference is required to initiate settlement.")
  }

  const existing = await SettlementRecord.findOne({
    providerReference: normalizedRef,
    rail: input.rail,
  })

  if (existing) {
    return { settlement: existing, alreadyExists: true }
  }

  const initialState = input.initialState || "initiated"
  const env = process.env.NODE_ENV || "development"
  const railConfig = getRailSettlementConfig(input.rail, env)
  const settlementId = generateSettlementId()

  const safeActions = determineSafeActions(initialState, false)

  const initialTimelineEntry: OperatorTimelineEntry = {
    fromState: null,
    toState: initialState,
    triggeredBy: input.triggeredBy || "system",
    reason: input.reason || "Settlement record initiated",
    safeActions,
    metadata: input.metadata,
    timestamp: new Date(),
  }

  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    const [settlement] = await SettlementRecord.create(
      [
        {
          settlementId,
          rail: input.rail,
          environment: env,
          currentState: initialState,
          providerReference: normalizedRef,
          stellarHash: input.stellarHash,
          ledgerJournalId: input.ledgerJournalId,
          poolInvestmentId: input.poolInvestmentId,
          driverPaymentId: input.driverPaymentId,
          userTransactionId: input.userTransactionId,
          userId: input.userId,
          userType: input.userType,
          paymentType: input.paymentType,
          amount: input.amount,
          currency: input.currency || "NGN",
          finalityThreshold: railConfig.finalityThreshold,
          timeline: [initialTimelineEntry],
          isStuck: false,
        },
      ],
      { session },
    )

    if (["initiated", "provider-pending", "observed", "provisionally_credited"].includes(initialState)) {
      if (input.paymentType === "wallet_funding") {
        await User.findByIdAndUpdate(
          input.userId,
          { $inc: { pendingBalance: input.amount } },
          { session },
        )
      }
    }

    await session.commitTransaction()
    return { settlement, alreadyExists: false }
  } catch (err: any) {
    await session.abortTransaction().catch(() => undefined)
    if (err.code === 11000) {
      const found = await SettlementRecord.findOne({
        providerReference: normalizedRef,
        rail: input.rail,
      })
      if (found) return { settlement: found, alreadyExists: true }
    }
    throw err
  } finally {
    session.endSession()
  }
}

export async function transitionSettlementState(
  input: TransitionStateInput,
): Promise<{ settlement: ISettlementRecord; previousState: CanonicalSettlementState }> {
  await dbConnect()

  return runInSession(input.session, async (session) => {
    let settlement: ISettlementRecord | null = null

    if (input.settlementId) {
      settlement = await SettlementRecord.findOne({ settlementId: input.settlementId }).session(session)
    } else if (input.providerReference) {
      settlement = await SettlementRecord.findOne({ providerReference: input.providerReference.trim() }).session(session)
    }

    if (!settlement) {
      throw new Error(`Settlement record not found for reference: ${input.settlementId || input.providerReference}`)
    }

    const previousState = settlement.currentState
    const targetState = input.targetState

    if (previousState === targetState) {
      return { settlement, previousState }
    }

    if (!isValidTransition(previousState, targetState)) {
      throw new Error(`Invalid settlement state transition from '${previousState}' to '${targetState}'.`)
    }

    if (input.stellarHash) settlement.stellarHash = input.stellarHash
    if (input.ledgerJournalId) settlement.ledgerJournalId = input.ledgerJournalId
    if (input.poolInvestmentId) settlement.poolInvestmentId = input.poolInvestmentId
    if (input.userTransactionId) settlement.userTransactionId = input.userTransactionId
    if (input.driverPaymentId) settlement.driverPaymentId = input.driverPaymentId
    if (input.confirmationsCount !== undefined) {
      settlement.confirmationsCount = input.confirmationsCount
    }

    const safeActions = determineSafeActions(targetState, false)
    const timelineEntry: OperatorTimelineEntry = {
      fromState: previousState,
      toState: targetState,
      triggeredBy: input.triggeredBy,
      reason: input.reason,
      safeActions,
      metadata: input.metadata,
      timestamp: new Date(),
    }

    settlement.currentState = targetState
    settlement.timeline.push(timelineEntry)
    settlement.isStuck = false
    settlement.stuckReason = undefined

    // Apply balance bucket movements based on state transition
    const user = await User.findById(settlement.userId).session(session)
    const amount = settlement.amount

    if (user && settlement.paymentType === "wallet_funding") {
      const wasPending = ["initiated", "provider-pending", "observed", "provisionally_credited"].includes(previousState)

      if (targetState === "confirmed") {
        if (wasPending) {
          const currentPending = Number(user.pendingBalance || 0)
          const pendingDeduction = Math.min(currentPending, amount)
          user.pendingBalance = Math.max(currentPending - pendingDeduction, 0)
        }
        user.availableBalance = Number(user.availableBalance || 0) + amount
      } else if (targetState === "reversed") {
        await executeReversalJournal(user, settlement, input, session)
      } else if (targetState === "disputed") {
        const currentAvailable = Number(user.availableBalance || 0)
        const holdDeduction = Math.min(currentAvailable, amount)
        user.availableBalance = Math.max(currentAvailable - holdDeduction, 0)
        user.heldBalance = Number(user.heldBalance || 0) + holdDeduction
      } else if (targetState === "failed" || targetState === "expired") {
        if (wasPending) {
          const currentPending = Number(user.pendingBalance || 0)
          user.pendingBalance = Math.max(currentPending - Math.min(currentPending, amount), 0)
        }
      }

      await user.save({ session })
    } else if (user && targetState === "reversed") {
      await executeReversalJournal(user, settlement, input, session)
      await user.save({ session })
    }

    await settlement.save({ session })

    return { settlement, previousState }
  })
}

async function executeReversalJournal(
  user: any,
  settlement: ISettlementRecord,
  input: TransitionStateInput,
  session: ClientSession,
) {
  const amount = settlement.amount
  const currentAvailable = Number(user.availableBalance || 0)

  let deductedFromAvailable = 0
  let deductedFromHeld = 0
  let deductedFromPending = 0

  if (currentAvailable >= amount) {
    deductedFromAvailable = amount
  } else {
    deductedFromAvailable = currentAvailable
    const remainder = amount - currentAvailable
    const currentHeld = Number(user.heldBalance || 0)
    if (currentHeld >= remainder) {
      deductedFromHeld = remainder
    } else {
      deductedFromHeld = currentHeld
      const secondRemainder = remainder - currentHeld
      const currentPending = Number(user.pendingBalance || 0)
      deductedFromPending = Math.min(currentPending, secondRemainder)
    }
  }

  user.availableBalance = Math.max(currentAvailable - deductedFromAvailable, 0)
  user.heldBalance = Math.max(Number(user.heldBalance || 0) - deductedFromHeld, 0)
  user.pendingBalance = Math.max(Number(user.pendingBalance || 0) - deductedFromPending, 0)
  user.reversedBalance = Number(user.reversedBalance || 0) + amount

  const reversalTx = await Transaction.create(
    [
      {
        userId: user._id,
        userType: settlement.userType,
        type: "wallet_debit",
        amount,
        currency: settlement.currency,
        method: settlement.rail === "paystack" ? "paystack" : "system",
        status: "Completed",
        gatewayReference: `REV-${settlement.providerReference}`,
        description: `Settlement reversal journal for ${settlement.providerReference}`,
        relatedId: settlement.userTransactionId || settlement.settlementId,
        metadata: {
          reversalReason: input.reason,
          settlementId: settlement.settlementId,
          originalReference: settlement.providerReference,
          deductedFromAvailable,
          deductedFromHeld,
          deductedFromPending,
        },
      },
    ],
    { session },
  )

  settlement.ledgerJournalId = reversalTx[0]._id.toString()

  await AuditLog.create(
    [
      {
        userId: user._id,
        action: "SETTLEMENT_REVERSAL_POSTED",
        targetModel: "SettlementRecord",
        targetId: settlement.settlementId,
        details: {
          providerReference: settlement.providerReference,
          amount,
          reversalJournalId: reversalTx[0]._id.toString(),
          reason: input.reason,
          deductedFromAvailable,
          deductedFromHeld,
          deductedFromPending,
        },
        timestamp: new Date(),
      },
    ],
    { session },
  )
}

export async function evaluateFinalityTimeouts(): Promise<{
  evaluatedCount: number
  stuckCount: number
  expiredCount: number
}> {
  await dbConnect()
  const now = new Date()
  const activeSettlements = await SettlementRecord.find({
    currentState: { $in: ["initiated", "provider-pending", "observed", "provisionally_credited"] },
  })

  let stuckCount = 0
  let expiredCount = 0

  for (const s of activeSettlements) {
    const config = getRailSettlementConfig(
      s.rail,
      s.environment as "development" | "production" | "test" | undefined,
    )
    const ageMs = now.getTime() - new Date(s.createdAt).getTime()
    const thresholdMs =
      s.currentState === "observed" || s.currentState === "provisionally_credited"
        ? config.observedTimeoutMs
        : config.pendingTimeoutMs

    if (ageMs > thresholdMs) {
      if (config.autoExpireOnTimeout) {
        await transitionSettlementState({
          settlementId: s.settlementId,
          targetState: "expired",
          triggeredBy: "system",
          reason: `Settlement automatically expired after exceeding timeout threshold (${Math.round(thresholdMs / 1000)}s)`,
        })
        expiredCount++
      } else {
        s.isStuck = true
        s.stuckReason = `Settlement pending for ${Math.round(ageMs / 60000)} mins exceeding limit of ${Math.round(thresholdMs / 60000)} mins.`
        s.actionableAlertSent = true
        s.lastEvaluatedAt = now
        await s.save()
        stuckCount++
      }
    }
  }

  return { evaluatedCount: activeSettlements.length, stuckCount, expiredCount }
}
