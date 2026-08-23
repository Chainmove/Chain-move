/**
 * Repayment Engine Service
 *
 * Orchestrates the full repayment lifecycle:
 *   1. Apply confirmed driver payment through the allocation engine
 *   2. Persist the transparent PaymentAllocation record (idempotent by gatewayRef)
 *   3. Update HirePurchaseContract.totalPaidNgn and nextDueDate
 *   4. Trigger COMPLETED transition when balance reaches zero
 *   5. Support reversal/correction without deleting payment history
 *
 * This service is the single authoritative entry-point for repayment logic.
 * Existing confirmDriverPayment in driver-contracts.service.ts delegates here.
 */

import mongoose, { type ClientSession } from "mongoose"

import dbConnect from "@/lib/dbConnect"
import { isRepayableState } from "@/lib/contracts/state-machine"
import { transitionHirePurchaseContract } from "@/lib/services/contract-transition.service"
import { logAuditEvent } from "@/lib/security/audit-log"
import {
  allocatePayment,
  buildInstallmentStates,
  calculateNextDueDateFromSchedule,
  computeArrears,
} from "@/lib/repayments/allocation-engine"
import DriverPayment from "@/models/DriverPayment"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import PaymentAllocation from "@/models/PaymentAllocation"
import PaymentReversal, { type PaymentReversalReason } from "@/models/PaymentReversal"
import Transaction from "@/models/Transaction"
import User from "@/models/User"

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ApplyPaymentInput {
  /** paystackRef – gateway idempotency key */
  gatewayRef: string
  /** Verified amount from the payment gateway (kobo-precise) */
  verifiedAmountNgn: number
  channel?: string | null
  metadata?: Record<string, unknown>
}

export interface ApplyPaymentResult {
  alreadyProcessed: boolean
  allocation: {
    acceptedAmountNgn: number
    excessAmountNgn: number
    arrearsNgn: number
    currentInstallmentNgn: number
    feesNgn: number
    principalNgn: number
    remainingBalanceAfterNgn: number
    nextDueDateAfterIso: string | null
  }
  contractCompleted: boolean
}

export interface ReversePaymentInput {
  originalGatewayRef: string
  reason: PaymentReversalReason
  notes: string
  initiatedByUserId: string
}

export interface ReversePaymentResult {
  reversalId: string
  reversedAmountNgn: number
  newRemainingBalanceNgn: number
}

export interface ArrearsReport {
  overdueCount: number
  arrearsAmountNgn: number
  oldestOverdueDateIso: string | null
  arrearsDays: number
}

export interface ScheduleCheckResult {
  contractId: string
  valid: boolean
  issues: string[]
  /** Whether the stored totalPaidNgn is consistent with payment records */
  balanceConsistent: boolean
  storedTotalPaidNgn: number
  derivedTotalPaidNgn: number
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function toObjectId(value: string, label: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${label}.`)
  }
  return new mongoose.Types.ObjectId(value)
}

function roundKobo(value: number): number {
  return Math.round(value * 100) / 100
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0
  return Math.max(value, 0)
}

function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: number }).code === 11000
  )
}

async function runInSession<T>(
  existingSession: ClientSession | undefined,
  fn: (session: ClientSession) => Promise<T>,
): Promise<T> {
  if (existingSession) return fn(existingSession)

  const session = await mongoose.startSession()
  session.startTransaction()
  try {
    const result = await fn(session)
    await session.commitTransaction()
    return result
  } catch (error) {
    await session.abortTransaction().catch(() => undefined)
    throw error
  } finally {
    session.endSession()
  }
}

// ─── Core Engine Functions ────────────────────────────────────────────────────

/**
 * Apply a confirmed payment through the allocation engine and persist all
 * side-effects atomically.  This function is **idempotent**: calling it twice
 * with the same gatewayRef is safe and returns { alreadyProcessed: true } on
 * the second call.
 *
 * Edge-cases handled:
 *   - Payment received before contract activation → rejects (not repayable)
 *   - Payment larger than remaining balance → accepted = capped, excess returned
 *   - Completed contract receiving another webhook → alreadyProcessed = true
 *   - Multiple payments on the same day → all accepted individually; each
 *     gets its own PaymentAllocation
 *   - Duplicate references → idempotent (second call short-circuits)
 */
export async function applyDriverPayment(
  gatewayRef: string,
  input: ApplyPaymentInput,
  session?: ClientSession,
): Promise<ApplyPaymentResult> {
  await dbConnect()

  const normalizedRef = gatewayRef.trim()
  if (!normalizedRef) throw new Error("gatewayRef is required.")

  // Idempotency check: if a PaymentAllocation already exists for this ref, skip.
  const existingAllocation = await PaymentAllocation.findOne({ gatewayRef: normalizedRef }).lean()
  if (existingAllocation) {
    return {
      alreadyProcessed: true,
      allocation: {
        acceptedAmountNgn: Number(existingAllocation.acceptedAmountNgn),
        excessAmountNgn: Number(existingAllocation.excessAmountNgn),
        arrearsNgn: Number(existingAllocation.arrearsNgn),
        currentInstallmentNgn: Number(existingAllocation.currentInstallmentNgn),
        feesNgn: Number(existingAllocation.feesNgn),
        principalNgn: Number(existingAllocation.principalNgn),
        remainingBalanceAfterNgn: Number(existingAllocation.remainingBalanceAfterNgn),
        nextDueDateAfterIso: existingAllocation.nextDueDateAfterIso ?? null,
      },
      contractCompleted: false,
    }
  }

  return runInSession(session, async (activeSession) => {
    const payment = await DriverPayment.findOne({ paystackRef: normalizedRef }).session(activeSession)
    if (!payment) throw new Error("Driver payment record not found.")

    const contract = await HirePurchaseContract.findById(payment.contractId).session(activeSession)
    if (!contract) throw new Error("Linked hire-purchase contract not found.")

    if (!isRepayableState(contract.status)) {
      // Completed contract receiving another webhook → idempotent no-op.
      if (contract.status === "COMPLETED" || contract.status === "CLOSED") {
        return {
          alreadyProcessed: true,
          allocation: {
            acceptedAmountNgn: 0,
            excessAmountNgn: clamp(input.verifiedAmountNgn),
            arrearsNgn: 0,
            currentInstallmentNgn: 0,
            feesNgn: 0,
            principalNgn: 0,
            remainingBalanceAfterNgn: 0,
            nextDueDateAfterIso: null,
          },
          contractCompleted: true,
        }
      }
      throw new Error(`Contract is not in a repayable state (status: ${contract.status}).`)
    }

    const verifiedAmountNgn = clamp(roundKobo(Number(input.verifiedAmountNgn || payment.amountNgn)))
    if (verifiedAmountNgn <= 0) throw new Error("Invalid verified payment amount.")

    const totalPaidNgn = clamp(Number(contract.totalPaidNgn || 0))
    const totalPayableNgn = clamp(Number(contract.totalPayableNgn || 0))
    const remainingBalanceNgn = roundKobo(Math.max(totalPayableNgn - totalPaidNgn, 0))

    if (remainingBalanceNgn <= 0) {
      throw new Error("Contract has already been settled.")
    }

    // Build current installment states from contract terms.
    const now = new Date()
    const installments = buildInstallmentStates(contract as any, now)

    // Run the deterministic allocation.
    const allocationResult = allocatePayment({
      amountNgn: verifiedAmountNgn,
      schedule: installments,
      remainingContractBalanceNgn: remainingBalanceNgn,
    })

    const { acceptedAmountNgn, excessAmountNgn, breakdown } = allocationResult

    // Update contract totals.
    const newTotalPaidNgn = roundKobo(totalPaidNgn + acceptedAmountNgn)
    const newRemainingBalanceNgn = roundKobo(Math.max(totalPayableNgn - newTotalPaidNgn, 0))

    // Calculate next due date from updated installments.
    const nextDueDate = calculateNextDueDateFromSchedule(allocationResult.updatedInstallments)
    const nextDueDateAfterIso = nextDueDate ? nextDueDate.toISOString() : null

    // Persist PaymentAllocation (unique on gatewayRef for idempotency).
    try {
      await PaymentAllocation.create(
        [
          {
            paymentId: payment._id,
            contractId: contract._id,
            driverUserId: payment.driverUserId,
            gatewayRef: normalizedRef,
            amountNgn: verifiedAmountNgn,
            acceptedAmountNgn,
            excessAmountNgn,
            arrearsNgn: breakdown.arrearsNgn,
            currentInstallmentNgn: breakdown.currentInstallmentNgn,
            feesNgn: breakdown.feesNgn,
            principalNgn: breakdown.principalNgn,
            installmentCredits: breakdown.installmentCredits,
            remainingBalanceAfterNgn: newRemainingBalanceNgn,
            nextDueDateAfterIso,
          },
        ],
        { session: activeSession },
      )
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        // Race condition: another request created the allocation concurrently.
        return {
          alreadyProcessed: true,
          allocation: {
            acceptedAmountNgn,
            excessAmountNgn,
            arrearsNgn: breakdown.arrearsNgn,
            currentInstallmentNgn: breakdown.currentInstallmentNgn,
            feesNgn: breakdown.feesNgn,
            principalNgn: breakdown.principalNgn,
            remainingBalanceAfterNgn: newRemainingBalanceNgn,
            nextDueDateAfterIso,
          },
          contractCompleted: false,
        }
      }
      throw err
    }

    // Update contract.
    contract.totalPaidNgn = newTotalPaidNgn
    contract.nextDueDate = nextDueDate
    await contract.save({ session: activeSession })

    // Update payment record.
    payment.amountNgn = verifiedAmountNgn
    payment.appliedAmountNgn = acceptedAmountNgn
    payment.status = "CONFIRMED"
    payment.confirmedAt = now
    payment.metadata = {
      ...(payment.metadata as Record<string, unknown> | undefined),
      ...(input.metadata || {}),
      channel: input.channel ?? null,
      excessAmountNgn,
      allocationBreakdown: breakdown,
    }
    await payment.save({ session: activeSession })

    // Credit excess to driver wallet.
    if (excessAmountNgn > 0) {
      await User.updateOne(
        { _id: payment.driverUserId },
        { $inc: { availableBalance: excessAmountNgn } },
        { session: activeSession },
      )
      await Transaction.create(
        [
          {
            userId: payment.driverUserId,
            userType: "driver",
            type: "wallet_funding",
            amount: excessAmountNgn,
            currency: "NGN",
            method: "system",
            status: "Completed",
            description: "Excess repayment amount credited to internal wallet.",
            relatedId: contract._id.toString(),
            gatewayReference: `${normalizedRef}_excess`,
            metadata: { source: "repayment_excess", paymentId: payment._id.toString() },
          },
        ],
        { session: activeSession },
      )
    }

    // Check for contract completion.
    let contractCompleted = false
    if (newRemainingBalanceNgn <= 0 && contract.status !== "COMPLETED") {
      const { contract: completedContract } = await transitionHirePurchaseContract({
        contractId: contract._id.toString(),
        targetState: "COMPLETED",
        actor: { type: "system" },
        reason: "Final repayment installment confirmed; payable balance fully settled.",
        metadata: { gatewayRef: normalizedRef },
        session: activeSession,
      })
      contract.status = completedContract.status
      contractCompleted = true
    }

    await logAuditEvent({
      action: "repayment.applied",
      targetType: "HirePurchaseContract",
      targetId: contract._id.toString(),
      metadata: {
        gatewayRef: normalizedRef,
        verifiedAmountNgn,
        acceptedAmountNgn,
        excessAmountNgn,
        newRemainingBalanceNgn,
        contractCompleted,
      },
    })

    return {
      alreadyProcessed: false,
      allocation: {
        acceptedAmountNgn,
        excessAmountNgn,
        arrearsNgn: breakdown.arrearsNgn,
        currentInstallmentNgn: breakdown.currentInstallmentNgn,
        feesNgn: breakdown.feesNgn,
        principalNgn: breakdown.principalNgn,
        remainingBalanceAfterNgn: newRemainingBalanceNgn,
        nextDueDateAfterIso,
      },
      contractCompleted,
    }
  })
}

/**
 * Reverse a previously confirmed driver payment.
 *
 * Creates a compensating PaymentReversal record without deleting payment history.
 * Adjusts the contract's totalPaidNgn and recalculates the next due date.
 *
 * Edge-cases handled:
 *   - Reversed provider charge (PROVIDER_CHARGEBACK)
 *   - Admin correction (ADMIN_CORRECTION)
 *   - Prevents reversing the same payment twice (unique index on PENDING/APPLIED)
 */
export async function reverseDriverPayment(input: ReversePaymentInput): Promise<ReversePaymentResult> {
  await dbConnect()

  const { originalGatewayRef, reason, notes, initiatedByUserId } = input
  const normalizedRef = originalGatewayRef.trim()
  if (!normalizedRef) throw new Error("originalGatewayRef is required.")
  if (!notes?.trim()) throw new Error("A reversal note is required.")

  const initiatedByObjectId = toObjectId(initiatedByUserId, "initiatedByUserId")

  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    const payment = await DriverPayment.findOne({ paystackRef: normalizedRef }).session(session)
    if (!payment) throw new Error("Original driver payment not found.")
    if (payment.status !== "CONFIRMED") {
      throw new Error(`Only CONFIRMED payments can be reversed (status: ${payment.status}).`)
    }

    const contract = await HirePurchaseContract.findById(payment.contractId).session(session)
    if (!contract) throw new Error("Linked hire-purchase contract not found.")

    const reversedAmountNgn = clamp(Number(payment.appliedAmountNgn || 0))
    if (reversedAmountNgn <= 0) throw new Error("Payment has no applied amount to reverse.")

    // Create the reversal record (unique partial index prevents double-reversal).
    let reversal: any
    try {
      const [doc] = await PaymentReversal.create(
        [
          {
            originalPaymentId: payment._id,
            contractId: contract._id,
            driverUserId: payment.driverUserId,
            reversedAmountNgn,
            reason,
            notes: notes.trim(),
            initiatedBy: initiatedByObjectId,
            status: "PENDING",
          },
        ],
        { session },
      )
      reversal = doc
    } catch (err) {
      if (isDuplicateKeyError(err)) {
        throw new Error("This payment has already been reversed or a reversal is pending.")
      }
      throw err
    }

    // Subtract the reversed amount from the contract totals.
    const newTotalPaidNgn = roundKobo(Math.max(Number(contract.totalPaidNgn || 0) - reversedAmountNgn, 0))
    const totalPayableNgn = clamp(Number(contract.totalPayableNgn || 0))
    const newRemainingBalanceNgn = roundKobo(Math.max(totalPayableNgn - newTotalPaidNgn, 0))

    // Recalculate next due date.
    const updatedInstallments = buildInstallmentStates(
      { ...contract.toObject(), totalPaidNgn: newTotalPaidNgn },
      new Date(),
    )
    const nextDueDate = calculateNextDueDateFromSchedule(updatedInstallments)

    contract.totalPaidNgn = newTotalPaidNgn
    contract.nextDueDate = nextDueDate
    await contract.save({ session })

    // Mark reversal as applied.
    reversal.status = "APPLIED"
    reversal.appliedAt = new Date()
    await reversal.save({ session })

    // Remove or negate the PaymentAllocation for this gateway ref.
    await PaymentAllocation.deleteOne({ gatewayRef: normalizedRef }, { session })

    // Create a compensating transaction.
    await Transaction.create(
      [
        {
          userId: payment.driverUserId,
          userType: "driver",
          type: "repayment_reversal",
          amount: reversedAmountNgn,
          currency: "NGN",
          method: "system",
          status: "Completed",
          description: `Repayment reversal for ${contract.vehicleDisplayName} (${reason})`,
          relatedId: contract._id.toString(),
          gatewayReference: `${normalizedRef}_reversal`,
          metadata: {
            source: "repayment_reversal",
            originalPaymentId: payment._id.toString(),
            reversalId: reversal._id.toString(),
            reason,
          },
        },
      ],
      { session },
    )

    await logAuditEvent({
      action: "repayment.reversed",
      targetType: "HirePurchaseContract",
      targetId: contract._id.toString(),
      metadata: {
        originalGatewayRef: normalizedRef,
        reversedAmountNgn,
        reason,
        initiatedByUserId,
        newRemainingBalanceNgn,
      },
    })

    await session.commitTransaction()

    return {
      reversalId: reversal._id.toString(),
      reversedAmountNgn,
      newRemainingBalanceNgn,
    }
  } catch (error) {
    await session.abortTransaction().catch(() => undefined)
    throw error
  } finally {
    session.endSession()
  }
}

/**
 * Get current arrears report for a contract.
 */
export async function getArrearsReport(contractId: string): Promise<ArrearsReport> {
  await dbConnect()

  const contract = await HirePurchaseContract.findById(toObjectId(contractId, "contractId")).lean()
  if (!contract) throw new Error("Contract not found.")

  const installments = buildInstallmentStates(contract as any, new Date())
  return computeArrears(installments)
}

/**
 * Schedule regeneration / check command for legacy contracts.
 *
 * Verifies that the contract's stored totalPaidNgn is consistent with the
 * sum of all confirmed DriverPayment.appliedAmountNgn records, and that the
 * schedule terms are valid.
 */
export async function checkContractSchedule(contractId: string): Promise<ScheduleCheckResult> {
  await dbConnect()

  const contract = await HirePurchaseContract.findById(toObjectId(contractId, "contractId")).lean()
  if (!contract) throw new Error("Contract not found.")

  const issues: string[] = []

  // Validate schedule terms.
  const startDate = new Date((contract as any).startDate)
  if (Number.isNaN(startDate.getTime())) issues.push("startDate is invalid or missing")

  const weeklyPaymentNgn = Number((contract as any).weeklyPaymentNgn || 0)
  const durationWeeks = Number((contract as any).durationWeeks || 0)
  const totalPayableNgn = Number((contract as any).totalPayableNgn || 0)

  if (weeklyPaymentNgn <= 0) issues.push("weeklyPaymentNgn must be > 0")
  if (durationWeeks < 1) issues.push("durationWeeks must be >= 1")
  if (totalPayableNgn <= 0) issues.push("totalPayableNgn must be > 0")

  // Derive total paid from payment records.
  const paymentRecords = await DriverPayment.find({
    contractId: contract._id,
    status: "CONFIRMED",
  })
    .select("appliedAmountNgn")
    .lean()

  const derivedTotalPaidNgn = roundKobo(
    paymentRecords.reduce((sum, p) => sum + clamp(Number((p as any).appliedAmountNgn || 0)), 0),
  )
  const storedTotalPaidNgn = clamp(Number((contract as any).totalPaidNgn || 0))

  const balanceConsistent = Math.abs(storedTotalPaidNgn - derivedTotalPaidNgn) < 0.01

  if (!balanceConsistent) {
    issues.push(
      `totalPaidNgn mismatch: stored=${storedTotalPaidNgn.toFixed(2)}, derived=${derivedTotalPaidNgn.toFixed(2)}`,
    )
  }

  return {
    contractId,
    valid: issues.length === 0,
    issues,
    balanceConsistent,
    storedTotalPaidNgn,
    derivedTotalPaidNgn,
  }
}

/**
 * Repair the totalPaidNgn on a legacy contract by recomputing from payment records.
 * Only call after running checkContractSchedule and confirming the imbalance.
 */
export async function repairContractBalance(contractId: string): Promise<{ repairedAmountNgn: number }> {
  await dbConnect()

  const contractObjectId = toObjectId(contractId, "contractId")
  const contract = await HirePurchaseContract.findById(contractObjectId)
  if (!contract) throw new Error("Contract not found.")

  const paymentRecords = await DriverPayment.find({
    contractId: contractObjectId,
    status: "CONFIRMED",
  })
    .select("appliedAmountNgn")
    .lean()

  const derivedTotalPaidNgn = roundKobo(
    paymentRecords.reduce((sum, p) => sum + clamp(Number((p as any).appliedAmountNgn || 0)), 0),
  )

  const installments = buildInstallmentStates(
    { ...contract.toObject(), totalPaidNgn: derivedTotalPaidNgn },
    new Date(),
  )
  const nextDueDate = calculateNextDueDateFromSchedule(installments)

  contract.totalPaidNgn = derivedTotalPaidNgn
  contract.nextDueDate = nextDueDate
  await contract.save()

  await logAuditEvent({
    action: "repayment.balance_repaired",
    targetType: "HirePurchaseContract",
    targetId: contractId,
    metadata: {
      derivedTotalPaidNgn,
      previousTotalPaidNgn: Number(contract.totalPaidNgn),
    },
  })

  return { repairedAmountNgn: derivedTotalPaidNgn }
}
