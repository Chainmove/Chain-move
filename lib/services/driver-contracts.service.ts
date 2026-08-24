import mongoose, { type ClientSession } from "mongoose"

import dbConnect from "@/lib/dbConnect"
import { isRepayableState } from "@/lib/contracts/state-machine"
import {
  buildRepaymentSchedule,
  clampToNonNegative,
  type DriverRepaymentScheduleItem,
  type RepaymentScheduleStatus,
} from "@/lib/contracts/repayment-schedule"
import { generateReferenceId } from "@/lib/ids/reference-id"
import { transitionHirePurchaseContract } from "@/lib/services/contract-transition.service"
import DriverPayment from "@/models/DriverPayment"
import HirePurchaseContract, { HirePurchaseContractStatus } from "@/models/HirePurchaseContract"
import InvestorCredit from "@/models/InvestorCredit"
import PoolInvestment from "@/models/PoolInvestment"
import Transaction from "@/models/Transaction"
import User from "@/models/User"

type ContractStatus = HirePurchaseContractStatus
type DriverPaymentStatus = "PENDING" | "CONFIRMED" | "FAILED"

export type { RepaymentScheduleStatus, DriverRepaymentScheduleItem }

export interface DriverArrearsSummary {
  status: "CURRENT" | "LATE" | "COMPLETED"
  overdueInstallments: number
  arrearsAmountNgn: number
  oldestOverdueDate: string | null
}

export interface DriverContractSnapshot {
  id: string
  driverUserId: string
  poolId: string
  assetType: "SHUTTLE" | "KEKE"
  vehicleDisplayName: string
  principalNgn: number
  depositNgn: number
  totalPayableNgn: number
  durationWeeks: number
  durationMonths: number | null
  weeklyPaymentNgn: number
  startDate: string
  status: ContractStatus
  totalPaidNgn: number
  remainingBalanceNgn: number
  progressRatio: number
  nextDueDate: string | null
  nextPaymentAmountNgn: number
  schedule: DriverRepaymentScheduleItem[]
  arrears: DriverArrearsSummary
  overpaymentNgn: number
}

export interface DriverPaymentSnapshot {
  id: string
  contractId: string
  driverUserId: string
  amountNgn: number
  appliedAmountNgn: number
  method: "PAYSTACK"
  paystackRef: string
  payerEmail: string | null
  status: DriverPaymentStatus
  confirmedAt: string | null
  failedReason: string | null
  overpaymentNgn: number
  createdAt: string
}

export interface CreateDriverPaymentInput {
  contractId: string
  driverUserId: string
  amountNgn: number
  payerEmail?: string
  paystackRef?: string
  metadata?: Record<string, unknown>
}

export interface GetDriverPaymentsInput {
  driverUserId: string
  contractId?: string
  limit?: number
  startDate?: Date | null
}

export interface PaymentDistributionResult {
  paymentId: string
  poolId: string
  distributedAmountNgn: number
  investorCreditsCount: number
  remainderNgn: number
  alreadyDistributed: boolean
}

interface ConfirmDriverPaymentOptions {
  verifiedAmountNgn?: number
  channel?: string | null
  metadata?: Record<string, unknown>
}

export interface ConfirmDriverPaymentResult {
  alreadyProcessed: boolean
  payment: DriverPaymentSnapshot
  contract: DriverContractSnapshot
  distribution: PaymentDistributionResult
}

function toObjectId(value: string, fieldLabel: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new Error(`Invalid ${fieldLabel}.`)
  }
  return new mongoose.Types.ObjectId(value)
}

function toIsoDate(value: Date | string | null | undefined) {
  if (!value) return null
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return null
  return date.toISOString()
}

function computeRemainingBalance(totalPayableNgn: number, totalPaidNgn: number) {
  return Math.max(totalPayableNgn - totalPaidNgn, 0)
}

function computeProgressRatio(totalPayableNgn: number, totalPaidNgn: number) {
  if (!Number.isFinite(totalPayableNgn) || totalPayableNgn <= 0) return 0
  return Math.min(Math.max(totalPaidNgn / totalPayableNgn, 0), 1)
}

function computeArrearsSummary(schedule: DriverRepaymentScheduleItem[], contractStatus: ContractStatus): DriverArrearsSummary {
  if (!isRepayableState(contractStatus)) {
    return { status: "COMPLETED", overdueInstallments: 0, arrearsAmountNgn: 0, oldestOverdueDate: null }
  }

  const overdueRows = schedule.filter((item) => item.status === "LATE" || item.status === "PARTIAL")
  const arrearsAmountNgn = overdueRows.reduce((sum, item) => sum + item.remainingAmountNgn, 0)
  return {
    status: overdueRows.length > 0 ? "LATE" : "CURRENT",
    overdueInstallments: overdueRows.length,
    arrearsAmountNgn,
    oldestOverdueDate: overdueRows[0]?.dueDate || null,
  }
}

function calculateNextDueDate(contract: {
  startDate: Date
  weeklyPaymentNgn: number
  durationWeeks: number
  totalPaidNgn: number
  totalPayableNgn: number
}) {
  const weeklyPaymentNgn = Number(contract.weeklyPaymentNgn || 0)
  const durationWeeks = Number(contract.durationWeeks || 0)

  if (weeklyPaymentNgn <= 0 || durationWeeks <= 0) return null
  if (contract.totalPaidNgn >= contract.totalPayableNgn) return null

  const paidInstallments = Math.floor(contract.totalPaidNgn / weeklyPaymentNgn)
  if (paidInstallments >= durationWeeks) return null

  const dueDate = new Date(contract.startDate)
  dueDate.setDate(dueDate.getDate() + (paidInstallments + 1) * 7)
  return dueDate
}

function mapContractSnapshot(contract: any): DriverContractSnapshot {
  const totalPayableNgn = clampToNonNegative(Number(contract.totalPayableNgn || 0))
  const totalPaidNgn = clampToNonNegative(Number(contract.totalPaidNgn || 0))
  const remainingBalanceNgn = computeRemainingBalance(totalPayableNgn, totalPaidNgn)
  const weeklyPaymentNgn = clampToNonNegative(Number(contract.weeklyPaymentNgn || 0))
  const overpaymentNgn = clampToNonNegative(totalPaidNgn - totalPayableNgn)
  const schedule = buildRepaymentSchedule(contract)
  const arrears = computeArrearsSummary(schedule, contract.status)

  return {
    id: contract._id.toString(),
    driverUserId: contract.driverUserId.toString(),
    poolId: contract.poolId.toString(),
    assetType: contract.assetType,
    vehicleDisplayName: contract.vehicleDisplayName,
    principalNgn: clampToNonNegative(Number(contract.principalNgn || 0)),
    depositNgn: clampToNonNegative(Number(contract.depositNgn || 0)),
    totalPayableNgn,
    durationWeeks: Number(contract.durationWeeks || 0),
    durationMonths: Number.isFinite(contract.durationMonths) ? Number(contract.durationMonths) : null,
    weeklyPaymentNgn,
    startDate: toIsoDate(contract.startDate) || new Date(0).toISOString(),
    status: contract.status,
    totalPaidNgn,
    remainingBalanceNgn,
    progressRatio: computeProgressRatio(totalPayableNgn, totalPaidNgn),
    nextDueDate: toIsoDate(contract.nextDueDate),
    nextPaymentAmountNgn: Math.min(weeklyPaymentNgn, remainingBalanceNgn),
    schedule,
    arrears,
    overpaymentNgn,
  }
}

function mapDriverPaymentSnapshot(payment: any): DriverPaymentSnapshot {
  return {
    id: payment._id.toString(),
    contractId: payment.contractId.toString(),
    driverUserId: payment.driverUserId.toString(),
    amountNgn: clampToNonNegative(Number(payment.amountNgn || 0)),
    appliedAmountNgn: clampToNonNegative(Number(payment.appliedAmountNgn || 0)),
    method: payment.method,
    paystackRef: payment.paystackRef,
    payerEmail: payment.payerEmail || null,
    status: payment.status,
    confirmedAt: toIsoDate(payment.confirmedAt),
    failedReason: payment.failedReason || null,
    overpaymentNgn: clampToNonNegative(Number(payment.amountNgn || 0) - Number(payment.appliedAmountNgn || 0)),
    createdAt: toIsoDate(payment.createdAt) || new Date(0).toISOString(),
  }
}

const MAX_PAYSTACK_REFERENCE_COLLISION_RETRIES = 3

function buildDriverPaymentReference() {
  return generateReferenceId({ prefix: "cm_driver_repay" })
}

/** True when a Mongo duplicate-key error was raised by the unique `paystackRef` index specifically. */
function isPaystackRefCollision(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  const candidate = error as { code?: number; keyPattern?: Record<string, unknown> }
  return candidate.code === 11000 && Boolean(candidate.keyPattern && "paystackRef" in candidate.keyPattern)
}

async function runWithOptionalSession<T>(
  session: ClientSession | undefined,
  handler: (activeSession: ClientSession) => Promise<T>,
): Promise<T> {
  if (session) {
    return handler(session)
  }

  const ownedSession = await mongoose.startSession()
  ownedSession.startTransaction()

  try {
    const result = await handler(ownedSession)
    await ownedSession.commitTransaction()
    return result
  } catch (error) {
    await ownedSession.abortTransaction().catch(() => undefined)
    throw error
  } finally {
    ownedSession.endSession()
  }
}

function normalizeOwnershipBps(investedAmountNgn: number, totalInvestedNgn: number) {
  if (totalInvestedNgn <= 0) return 0
  return Math.min(Math.max(Math.floor((investedAmountNgn * 10_000) / totalInvestedNgn), 0), 10_000)
}

function isDuplicateKeyError(error: unknown) {
  if (!error || typeof error !== "object") return false
  const maybeMongoError = error as { code?: number }
  return maybeMongoError.code === 11000
}

export async function getDriverContract(driverUserId: string): Promise<DriverContractSnapshot | null> {
  await dbConnect()
  const driverObjectId = toObjectId(driverUserId, "driver user id")

  const activeContract = await HirePurchaseContract.findOne({
    driverUserId: driverObjectId,
    status: { $in: ["ACTIVE", "DELINQUENT", "RESTRUCTURED"] },
  })
    .sort({ createdAt: -1 })
    .lean()

  if (activeContract) {
    return mapContractSnapshot(activeContract)
  }

  const latestHistoricalContract = await HirePurchaseContract.findOne({
    driverUserId: driverObjectId,
    status: { $in: ["COMPLETED", "REPOSSESSED", "CANCELLED", "CLOSED"] },
  })
    .sort({ updatedAt: -1 })
    .lean()

  if (!latestHistoricalContract) {
    return null
  }

  return mapContractSnapshot(latestHistoricalContract)
}

export async function getDriverPayments({
  driverUserId,
  contractId,
  limit = 20,
  startDate,
}: GetDriverPaymentsInput): Promise<DriverPaymentSnapshot[]> {
  await dbConnect()
  const driverObjectId = toObjectId(driverUserId, "driver user id")

  const filter: Record<string, unknown> = {
    driverUserId: driverObjectId,
  }

  if (contractId) {
    filter.contractId = toObjectId(contractId, "contract id")
  }

  if (startDate) {
    filter.createdAt = { $gte: startDate }
  }

  const docs = await DriverPayment.find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.max(1, Math.min(limit, 200)))
    .lean()

  return docs.map(mapDriverPaymentSnapshot)
}

export async function createDriverPayment({
  contractId,
  driverUserId,
  amountNgn,
  payerEmail,
  paystackRef,
  metadata,
}: CreateDriverPaymentInput): Promise<DriverPaymentSnapshot> {
  await dbConnect()

  const contractObjectId = toObjectId(contractId, "contract id")
  const driverObjectId = toObjectId(driverUserId, "driver user id")
  const normalizedAmountNgn = Number(amountNgn)

  if (!Number.isFinite(normalizedAmountNgn) || normalizedAmountNgn <= 0) {
    throw new Error("Amount must be greater than zero.")
  }

  const contract = await HirePurchaseContract.findOne({
    _id: contractObjectId,
    driverUserId: driverObjectId,
  })

  if (!contract) {
    throw new Error("Contract not found.")
  }

  if (!isRepayableState(contract.status)) {
    throw new Error("This hire-purchase contract is not active.")
  }

  const remainingBalanceNgn = computeRemainingBalance(contract.totalPayableNgn, contract.totalPaidNgn)
  if (remainingBalanceNgn <= 0) {
    throw new Error("This contract is already fully paid.")
  }

  if (normalizedAmountNgn > remainingBalanceNgn) {
    throw new Error(`Amount exceeds remaining balance of NGN ${remainingBalanceNgn.toLocaleString("en-NG")}.`)
  }

  const callerSuppliedReference = paystackRef?.trim()
  const basePaymentFields = {
    contractId: contract._id,
    driverUserId: driverObjectId,
    amountNgn: normalizedAmountNgn,
    appliedAmountNgn: 0,
    method: "PAYSTACK" as const,
    payerEmail: payerEmail?.trim().toLowerCase() || undefined,
    metadata,
    status: "PENDING" as const,
  }

  if (callerSuppliedReference) {
    // A caller-supplied reference is the caller's own idempotency key — a
    // collision here is a genuine conflict, not something to retry past.
    const payment = await DriverPayment.create({ ...basePaymentFields, paystackRef: callerSuppliedReference })
    return mapDriverPaymentSnapshot(payment)
  }

  for (let attempt = 1; attempt <= MAX_PAYSTACK_REFERENCE_COLLISION_RETRIES; attempt++) {
    const generatedReference = buildDriverPaymentReference()
    try {
      const payment = await DriverPayment.create({ ...basePaymentFields, paystackRef: generatedReference })
      return mapDriverPaymentSnapshot(payment)
    } catch (error) {
      if (!isPaystackRefCollision(error)) throw error
      if (attempt === MAX_PAYSTACK_REFERENCE_COLLISION_RETRIES) {
        throw new Error(
          `Failed to generate a unique payment reference after ${MAX_PAYSTACK_REFERENCE_COLLISION_RETRIES} attempts.`,
        )
      }
      console.warn("DRIVER_PAYMENT_REFERENCE_COLLISION_RETRY", {
        attempt,
        generatedReference,
        contractId,
        driverUserId,
      })
    }
  }

  throw new Error(
    `Failed to generate a unique payment reference after ${MAX_PAYSTACK_REFERENCE_COLLISION_RETRIES} attempts.`,
  )
}

export async function createDriverTransferPayment({
  contractId,
  driverUserId,
  amountNgn,
  payerEmail,
  paystackRef,
  metadata,
}: CreateDriverPaymentInput): Promise<DriverPaymentSnapshot> {
  await dbConnect()

  const contractObjectId = toObjectId(contractId, "contract id")
  const driverObjectId = toObjectId(driverUserId, "driver user id")
  const normalizedAmountNgn = Number(amountNgn)
  const normalizedReference = paystackRef?.trim()

  if (!normalizedReference) {
    throw new Error("Payment reference is required.")
  }

  if (!Number.isFinite(normalizedAmountNgn) || normalizedAmountNgn <= 0) {
    throw new Error("Amount must be greater than zero.")
  }

  const existingPayment = await DriverPayment.findOne({ paystackRef: normalizedReference }).lean()
  if (existingPayment) {
    return mapDriverPaymentSnapshot(existingPayment)
  }

  const contract = await HirePurchaseContract.findOne({
    _id: contractObjectId,
    driverUserId: driverObjectId,
  })

  if (!contract) {
    throw new Error("Contract not found.")
  }

  if (!isRepayableState(contract.status)) {
    throw new Error("This hire-purchase contract is not active.")
  }

  const payment = await DriverPayment.create({
    contractId: contract._id,
    driverUserId: driverObjectId,
    amountNgn: normalizedAmountNgn,
    appliedAmountNgn: 0,
    method: "PAYSTACK",
    paystackRef: normalizedReference,
    payerEmail: payerEmail?.trim().toLowerCase() || undefined,
    metadata,
    status: "PENDING",
  })

  return mapDriverPaymentSnapshot(payment)
}

export async function createAndConfirmDriverTransferPayment({
  contractId,
  driverUserId,
  amountNgn,
  payerEmail,
  paystackRef,
  metadata,
  channel,
}: CreateDriverPaymentInput & { channel?: string | null }) {
  await createDriverTransferPayment({
    contractId,
    driverUserId,
    amountNgn,
    payerEmail,
    paystackRef,
    metadata,
  })

  return confirmDriverPayment(paystackRef || "", {
    verifiedAmountNgn: amountNgn,
    channel,
    metadata,
  })
}

export async function markDriverPaymentFailed({
  paystackRef,
  reason,
}: {
  paystackRef: string
  reason: string
}) {
  await dbConnect()
  await DriverPayment.updateOne(
    { paystackRef },
    {
      $set: {
        status: "FAILED",
        failedReason: reason,
      },
    },
  )
}

export async function distributePaymentToInvestors(
  paymentId: string,
  session?: ClientSession,
): Promise<PaymentDistributionResult> {
  await dbConnect()
  const paymentObjectId = toObjectId(paymentId, "payment id")

  return runWithOptionalSession(session, async (activeSession) => {
    const payment = await DriverPayment.findById(paymentObjectId).session(activeSession)
    if (!payment) {
      throw new Error("Driver payment not found for distribution.")
    }

    const existingCreditsCount = await InvestorCredit.countDocuments({ paymentId: payment._id }).session(activeSession)
    const amountForDistributionNgn = clampToNonNegative(Number(payment.appliedAmountNgn || payment.amountNgn || 0))

    const contract = await HirePurchaseContract.findById(payment.contractId).session(activeSession)
    if (!contract) {
      throw new Error("Hire-purchase contract not found for payment distribution.")
    }

    if (existingCreditsCount > 0) {
      return {
        paymentId: payment._id.toString(),
        poolId: contract.poolId.toString(),
        distributedAmountNgn: amountForDistributionNgn,
        investorCreditsCount: existingCreditsCount,
        remainderNgn: 0,
        alreadyDistributed: true,
      }
    }

    if (amountForDistributionNgn <= 0) {
      return {
        paymentId: payment._id.toString(),
        poolId: contract.poolId.toString(),
        distributedAmountNgn: 0,
        investorCreditsCount: 0,
        remainderNgn: 0,
        alreadyDistributed: false,
      }
    }

    const poolInvestments = await PoolInvestment.find({
      poolId: contract.poolId,
      status: "CONFIRMED",
    })
      .select("userId amountNgn")
      .session(activeSession)

    const aggregatedInvestmentsByInvestor = new Map<string, { userId: mongoose.Types.ObjectId; amountNgn: number }>()
    for (const row of poolInvestments) {
      const userId = row.userId as mongoose.Types.ObjectId
      const key = userId.toString()
      const amount = clampToNonNegative(Number(row.amountNgn || 0))
      if (amount <= 0) continue

      const current = aggregatedInvestmentsByInvestor.get(key)
      if (!current) {
        aggregatedInvestmentsByInvestor.set(key, { userId, amountNgn: amount })
      } else {
        current.amountNgn += amount
      }
    }

    const ownershipRows = Array.from(aggregatedInvestmentsByInvestor.values())
      .sort((a, b) => b.amountNgn - a.amountNgn)

    if (ownershipRows.length === 0) {
      return {
        paymentId: payment._id.toString(),
        poolId: contract.poolId.toString(),
        distributedAmountNgn: amountForDistributionNgn,
        investorCreditsCount: 0,
        remainderNgn: amountForDistributionNgn,
        alreadyDistributed: false,
      }
    }

    const totalInvestedNgn = ownershipRows.reduce((sum, row) => sum + row.amountNgn, 0)
    if (totalInvestedNgn <= 0) {
      return {
        paymentId: payment._id.toString(),
        poolId: contract.poolId.toString(),
        distributedAmountNgn: amountForDistributionNgn,
        investorCreditsCount: 0,
        remainderNgn: amountForDistributionNgn,
        alreadyDistributed: false,
      }
    }

    const totalDistributionKobo = Math.round(amountForDistributionNgn * 100)
    let allocatedKobo = 0
    const credits = ownershipRows.map((row, index) => {
      const rawCreditKobo = Math.floor((totalDistributionKobo * row.amountNgn) / totalInvestedNgn)
      allocatedKobo += rawCreditKobo
      return {
        investorUserId: row.userId,
        ownershipBps: normalizeOwnershipBps(row.amountNgn, totalInvestedNgn),
        creditKobo: rawCreditKobo,
        rank: index,
      }
    })

    const remainderKobo = Math.max(totalDistributionKobo - allocatedKobo, 0)
    if (remainderKobo > 0 && credits.length > 0) {
      // Assign rounding remainder to the largest shareholder.
      credits[0].creditKobo += remainderKobo
    }

    const nonZeroCredits = credits.filter((credit) => credit.creditKobo > 0)
    if (nonZeroCredits.length === 0) {
      return {
        paymentId: payment._id.toString(),
        poolId: contract.poolId.toString(),
        distributedAmountNgn: amountForDistributionNgn,
        investorCreditsCount: 0,
        remainderNgn: amountForDistributionNgn,
        alreadyDistributed: false,
      }
    }

    const investorCreditDocs = nonZeroCredits.map((credit) => ({
      paymentId: payment._id,
      poolId: contract.poolId,
      investorUserId: credit.investorUserId,
      amountNgn: credit.creditKobo / 100,
      ownershipBps: credit.ownershipBps,
      status: "POSTED" as const,
    }))

    await InvestorCredit.insertMany(investorCreditDocs, { session: activeSession })

    await User.bulkWrite(
      nonZeroCredits.map((credit) => ({
        updateOne: {
          filter: { _id: credit.investorUserId },
          update: {
            $inc: {
              availableBalance: credit.creditKobo / 100,
              totalReturns: credit.creditKobo / 100,
            },
          },
        },
      })),
      { session: activeSession },
    )

    const investorTransactionRows = nonZeroCredits.map((credit) => ({
      userId: credit.investorUserId,
      userType: "investor" as const,
      type: "return" as const,
      amount: credit.creditKobo / 100,
      currency: "NGN",
      method: "system" as const,
      status: "Completed" as const,
      relatedId: contract.poolId.toString(),
      gatewayReference: `${payment.paystackRef}_${credit.investorUserId.toString()}`,
      description: `Driver repayment credit from ${contract.vehicleDisplayName}`,
      metadata: {
        source: "driver_repayment",
        contractId: contract._id.toString(),
        paymentId: payment._id.toString(),
        ownershipBps: credit.ownershipBps,
      },
    }))

    await Transaction.insertMany(investorTransactionRows, { session: activeSession })

    return {
      paymentId: payment._id.toString(),
      poolId: contract.poolId.toString(),
      distributedAmountNgn: nonZeroCredits.reduce((sum, row) => sum + row.creditKobo / 100, 0),
      investorCreditsCount: nonZeroCredits.length,
      remainderNgn: 0,
      alreadyDistributed: false,
    }
  })
}

export async function confirmDriverPayment(
  paystackRef: string,
  options: ConfirmDriverPaymentOptions = {},
): Promise<ConfirmDriverPaymentResult> {
  await dbConnect()
  const normalizedReference = paystackRef?.trim()
  if (!normalizedReference) {
    throw new Error("Payment reference is required.")
  }

  const session = await mongoose.startSession()
  session.startTransaction()

  try {
    const payment = await DriverPayment.findOne({ paystackRef: normalizedReference }).session(session)
    if (!payment) {
      throw new Error("Driver payment record not found.")
    }

    const contract = await HirePurchaseContract.findById(payment.contractId).session(session)
    if (!contract) {
      throw new Error("Linked hire-purchase contract not found.")
    }

    if (payment.status === "CONFIRMED") {
      const snapshotContract = mapContractSnapshot(contract)
      const distribution = await distributePaymentToInvestors(payment._id.toString(), session)
      await session.commitTransaction()

      return {
        alreadyProcessed: true,
        payment: mapDriverPaymentSnapshot(payment),
        contract: snapshotContract,
        distribution,
      }
    }

    if (payment.status === "FAILED") {
      throw new Error(payment.failedReason || "This payment has already failed.")
    }

    if (!isRepayableState(contract.status)) {
      throw new Error("This contract is not active.")
    }

    const verifiedAmountNgn = Number.isFinite(options.verifiedAmountNgn)
      ? Number(options.verifiedAmountNgn)
      : Number(payment.amountNgn)

    if (!Number.isFinite(verifiedAmountNgn) || verifiedAmountNgn <= 0) {
      throw new Error("Invalid verified payment amount.")
    }

    const remainingBeforeNgn = computeRemainingBalance(contract.totalPayableNgn, contract.totalPaidNgn)
    if (remainingBeforeNgn <= 0) {
      throw new Error("This contract has already been settled.")
    }

    const appliedAmountNgn = Math.min(verifiedAmountNgn, remainingBeforeNgn)
    const unappliedAmountNgn = Math.max(verifiedAmountNgn - appliedAmountNgn, 0)

    payment.amountNgn = verifiedAmountNgn
    payment.appliedAmountNgn = appliedAmountNgn
    payment.status = "CONFIRMED"
    payment.confirmedAt = new Date()
    payment.failedReason = undefined
    payment.metadata = {
      ...(payment.metadata || {}),
      ...(options.metadata || {}),
      channel: options.channel || (payment.metadata as Record<string, unknown> | undefined)?.channel || null,
      unappliedAmountNgn,
    }
    await payment.save({ session })

    contract.totalPaidNgn = clampToNonNegative(Number(contract.totalPaidNgn || 0) + appliedAmountNgn)
    const remainingAfterNgn = computeRemainingBalance(contract.totalPayableNgn, contract.totalPaidNgn)
    contract.nextDueDate = remainingAfterNgn <= 0 ? null : calculateNextDueDate(contract as any)
    await contract.save({ session })

    if (remainingAfterNgn <= 0 && contract.status !== "COMPLETED") {
      const { contract: settledContract } = await transitionHirePurchaseContract({
        contractId: contract._id.toString(),
        targetState: "COMPLETED",
        actor: { type: "system" },
        reason: "Final repayment installment confirmed; payable balance fully settled.",
        metadata: { paystackRef: normalizedReference },
        session,
      })
      contract.status = settledContract.status
    }

    const existingRepaymentTx = await Transaction.findOne({
      gatewayReference: normalizedReference,
      type: "repayment",
      userId: payment.driverUserId,
    }).session(session)

    if (!existingRepaymentTx) {
      await Transaction.create(
        [
          {
            userId: payment.driverUserId,
            userType: "driver",
            type: "repayment",
            amount: appliedAmountNgn,
            currency: "NGN",
            method: "paystack",
            status: "Completed",
            description: `Hire-purchase repayment for ${contract.vehicleDisplayName}`,
            relatedId: contract._id.toString(),
            gatewayReference: normalizedReference,
            metadata: {
              source: "driver_repayment",
              paymentId: payment._id.toString(),
              unappliedAmountNgn,
            },
          },
        ],
        { session },
      )
    }

    if (unappliedAmountNgn > 0) {
      await User.updateOne(
        { _id: payment.driverUserId },
        { $inc: { availableBalance: unappliedAmountNgn } },
        { session },
      )

      await Transaction.create(
        [
          {
            userId: payment.driverUserId,
            userType: "driver",
            type: "wallet_funding",
            amount: unappliedAmountNgn,
            currency: "NGN",
            method: "system",
            status: "Completed",
            description: "Unapplied repayment amount credited to internal wallet.",
            relatedId: contract._id.toString(),
            gatewayReference: `${normalizedReference}_unapplied`,
            metadata: {
              source: "driver_repayment",
              paymentId: payment._id.toString(),
            },
          },
        ],
        { session },
      )
    }

    const distribution = await distributePaymentToInvestors(payment._id.toString(), session)
    await session.commitTransaction()

    return {
      alreadyProcessed: false,
      payment: mapDriverPaymentSnapshot(payment),
      contract: mapContractSnapshot(contract),
      distribution,
    }
  } catch (error) {
    await session.abortTransaction().catch(() => undefined)

    if (isDuplicateKeyError(error)) {
      const payment = (await DriverPayment.findOne({ paystackRef: normalizedReference }).lean()) as any
      if (payment) {
        const contract = (await HirePurchaseContract.findById(payment.contractId).lean()) as any
        if (contract) {
          const distribution = await distributePaymentToInvestors(payment._id.toString())
          return {
            alreadyProcessed: true,
            payment: mapDriverPaymentSnapshot(payment),
            contract: mapContractSnapshot(contract),
            distribution,
          }
        }
      }
    }

    throw error
  } finally {
    session.endSession()
  }
}
