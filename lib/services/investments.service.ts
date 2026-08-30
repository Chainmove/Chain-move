import crypto from "node:crypto"
import mongoose from "mongoose"
import { type ConsentRole, REQUIRED_INVESTMENT_DOCUMENTS, requireAcceptedConsent } from "@/lib/consent/financial-consent"
import InvestmentPool from "@/models/InvestmentPool"
import PoolInvestment from "@/models/PoolInvestment"
import InvestmentReservation, { type InvestmentReservationStatus } from "@/models/InvestmentReservation"
import Transaction from "@/models/Transaction"
import User from "@/models/User"

export const TOTAL_OWNERSHIP_UNITS = 1_000_000
export const INVESTMENT_RESERVATION_TTL_MS = 5 * 60 * 1000

const TERMINAL_RESERVATION_STATES = new Set<InvestmentReservationStatus>(["SETTLED", "EXPIRED", "CANCELLED", "FAILED"])
const RESERVATION_TRANSITIONS: Record<InvestmentReservationStatus, InvestmentReservationStatus[]> = {
  PENDING: ["RESERVED", "FAILED", "CANCELLED"],
  RESERVED: ["SETTLED", "EXPIRED", "CANCELLED", "FAILED"],
  SETTLED: [],
  EXPIRED: [],
  CANCELLED: [],
  FAILED: [],
}

interface OwnershipResult { ownershipUnits: number; ownershipBps: number }
interface InvestInPoolInput {
  poolId: string; userId: string; amountNgn: number; txRef?: string; idempotencyKey?: string
  consentAcceptanceId?: string; jurisdiction?: string; role?: ConsentRole
}
export interface InvestInPoolResult {
  poolId: string; userId: string; amountNgn: number; ownershipUnits: number; ownershipBps: number; txRef: string
  consentAcceptanceId: string; acceptedDocumentSetHash: string; poolStatus: "OPEN" | "FUNDED" | "CLOSED"
  currentRaisedNgn: number; targetAmountNgn: number; investorCount: number; userBalanceNgn: number
}

export function isValidReservationTransition(from: InvestmentReservationStatus, to: InvestmentReservationStatus) {
  return RESERVATION_TRANSITIONS[from].includes(to)
}
export function calculateOwnership(amountNgn: number, targetAmountNgn: number): OwnershipResult {
  return { ownershipUnits: Math.max(Math.floor((amountNgn * TOTAL_OWNERSHIP_UNITS) / targetAmountNgn), 0), ownershipBps: Math.max(Math.floor((amountNgn * 10_000) / targetAmountNgn), 0) }
}
function shouldRetryMongoTransaction(error: unknown) {
  const value = error as { code?: number; codeName?: string; errorLabels?: string[]; message?: string } | null
  return Boolean(value && (value.code === 251 || value.codeName === "NoSuchTransaction" || value.errorLabels?.includes("TransientTransactionError") || /does not match any in-progress transactions/i.test(value.message || "")))
}
function idempotencyKeyFor(input: InvestInPoolInput) { return input.idempotencyKey?.trim() || input.txRef?.trim() || crypto.randomUUID() }
function isDuplicateKeyError(error: unknown) { return (error as { code?: number } | null)?.code === 11000 }

async function resultForReservation(reservation: any): Promise<InvestInPoolResult | null> {
  if (reservation.status !== "SETTLED" || !reservation.poolInvestmentId) return null
  const [investment, pool, user] = await Promise.all([
    PoolInvestment.findById(reservation.poolInvestmentId).lean(), InvestmentPool.findById(reservation.poolId).lean(), User.findById(reservation.userId).lean(),
  ])
  if (!investment || !pool || !user) throw new Error("Investment reservation is incomplete.")
  return { poolId: String(pool._id), userId: String(user._id), amountNgn: investment.amountNgn, ownershipUnits: investment.ownershipUnits, ownershipBps: investment.ownershipBps, txRef: investment.txRef, consentAcceptanceId: investment.consentAcceptanceId, acceptedDocumentSetHash: investment.acceptedDocumentSetHash, poolStatus: pool.status, currentRaisedNgn: pool.currentRaisedNgn, targetAmountNgn: pool.targetAmountNgn, investorCount: pool.investorCount, userBalanceNgn: user.availableBalance }
}

/**
 * Settles a pool investment command in one MongoDB transaction. Conditional
 * debits and capacity updates make the database, rather than a stale read, the
 * arbiter of wallet balance and final pool capacity.
 */
export async function investInPool(input: InvestInPoolInput): Promise<InvestInPoolResult> {
  const { poolId, userId, amountNgn, consentAcceptanceId, jurisdiction = "NG", role = "investor" } = input
  if (!mongoose.Types.ObjectId.isValid(poolId)) throw new Error("Invalid pool ID.")
  if (!mongoose.Types.ObjectId.isValid(userId)) throw new Error("Invalid user ID.")
  if (!Number.isFinite(amountNgn) || amountNgn <= 0) throw new Error("Amount must be greater than zero.")
  const idempotencyKey = idempotencyKeyFor(input)
  const existing = await InvestmentReservation.findOne({ userId, idempotencyKey }).lean()
  if (existing) {
    const prior = await resultForReservation(existing)
    if (prior) return prior
    throw new Error("An investment with this idempotency key is still being processed.")
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const session = await mongoose.startSession()
    try {
      let result: InvestInPoolResult | undefined
      await session.withTransaction(async () => {
        const expiresAt = new Date(Date.now() + INVESTMENT_RESERVATION_TTL_MS)
        const reservation = await InvestmentReservation.create([{ poolId, userId, idempotencyKey, amountNgn, status: "PENDING", expiresAt }], { session }).then(([value]) => value)
        const pool = await InvestmentPool.findOne({ _id: poolId, status: "OPEN", minContributionNgn: { $lte: amountNgn }, $expr: { $gte: [{ $subtract: ["$targetAmountNgn", "$currentRaisedNgn"] }, amountNgn] } }).session(session)
        if (!pool) throw new Error("Pool is closed, funded, or lacks remaining capacity.")
        const user = await User.findOneAndUpdate({ _id: userId, availableBalance: { $gte: amountNgn }, $or: [{ kycStatus: "approved_stage2" }, { isKycVerified: true }, { kycVerified: true }] }, { $inc: { availableBalance: -amountNgn, heldBalance: amountNgn } }, { new: true, session })
        if (!user) throw new Error("Insufficient wallet balance or investor KYC is not approved.")
        reservation.status = "RESERVED"
        await reservation.save({ session })
        const ownership = calculateOwnership(amountNgn, pool.targetAmountNgn)
        const txRef = input.txRef?.trim() || `pool_${reservation._id}`
        const consent = await requireAcceptedConsent({ userId, role, jurisdiction, acceptanceId: consentAcceptanceId, requiredDocuments: REQUIRED_INVESTMENT_DOCUMENTS, intent: { type: "pool_investment", id: String(pool._id), terms: { amountNgn, txRef, poolId: String(pool._id), targetAmountNgn: pool.targetAmountNgn, jurisdiction } }, session })
        const hasExistingInvestment = await PoolInvestment.exists({ poolId: pool._id, userId: user._id, status: "CONFIRMED" }).session(session)
        const investment = await PoolInvestment.create([{ poolId: pool._id, userId: user._id, amountNgn, ...ownership, txRef, reservationId: reservation._id, consentAcceptanceId: consent.acceptanceId, acceptedDocumentSetHash: consent.documentSetHash, acceptedDocumentVersionIds: consent.documentVersionIds, status: "CONFIRMED" }], { session }).then(([value]) => value)
        const updatedPool = await InvestmentPool.findOneAndUpdate({ _id: pool._id, status: "OPEN", $expr: { $gte: [{ $subtract: ["$targetAmountNgn", "$currentRaisedNgn"] }, amountNgn] } }, { $inc: { currentRaisedNgn: amountNgn, investorCount: hasExistingInvestment ? 0 : 1 } }, { new: true, session })
        if (!updatedPool) throw new Error("Pool no longer has remaining capacity.")
        if (updatedPool.currentRaisedNgn >= updatedPool.targetAmountNgn) { updatedPool.status = "FUNDED"; await updatedPool.save({ session }) }
        await User.updateOne({ _id: user._id, heldBalance: { $gte: amountNgn } }, { $inc: { heldBalance: -amountNgn, totalInvested: amountNgn } }, { session })
        await Transaction.create([{ userId: user._id, userType: user.role || "investor", type: "pool_investment", amount: amountNgn, currency: "NGN", method: "internal_wallet", status: "Completed", description: `${updatedPool.assetType} pool investment`, relatedId: String(pool._id), gatewayReference: txRef, metadata: { reservationId: String(reservation._id), ownershipUnits: ownership.ownershipUnits, ownershipBps: ownership.ownershipBps, consentAcceptanceId: consent.acceptanceId, acceptedDocumentSetHash: consent.documentSetHash } }], { session })
        reservation.status = "SETTLED"; reservation.poolInvestmentId = investment._id; await reservation.save({ session })
        result = { poolId: String(updatedPool._id), userId: String(user._id), amountNgn, ...ownership, txRef, consentAcceptanceId: consent.acceptanceId, acceptedDocumentSetHash: consent.documentSetHash, poolStatus: updatedPool.status, currentRaisedNgn: updatedPool.currentRaisedNgn, targetAmountNgn: updatedPool.targetAmountNgn, investorCount: updatedPool.investorCount, userBalanceNgn: user.availableBalance }
      })
      if (result) return result
    } catch (error) {
      if (isDuplicateKeyError(error)) { const prior = await InvestmentReservation.findOne({ userId, idempotencyKey }).lean(); const result = prior && await resultForReservation(prior); if (result) return result }
      if (attempt === 2 || !shouldRetryMongoTransaction(error)) throw error
    } finally { await session.endSession() }
  }
  throw new Error("Unable to process investment transaction.")
}

/** Releases only still-reserved holds; SETTLED commands are intentionally excluded. */
export async function expireInvestmentReservations(now = new Date()) {
  const session = await mongoose.startSession(); let expired = 0
  try { await session.withTransaction(async () => {
    const reservations = await InvestmentReservation.find({ status: "RESERVED", expiresAt: { $lte: now } }).session(session)
    for (const reservation of reservations) {
      const released = await InvestmentReservation.findOneAndUpdate({ _id: reservation._id, status: "RESERVED", expiresAt: { $lte: now } }, { $set: { status: "EXPIRED" } }, { new: true, session })
      if (!released) continue
      await User.updateOne({ _id: released.userId, heldBalance: { $gte: released.amountNgn } }, { $inc: { heldBalance: -released.amountNgn, availableBalance: released.amountNgn } }, { session })
      expired += 1
    }
  }) } finally { await session.endSession() }
  return expired
}

export { TERMINAL_RESERVATION_STATES }
