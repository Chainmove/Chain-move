/**
 * Shared helpers for the wallet transaction ledger dashboard.
 *
 * These utilities are used by both the ledger list API and the CSV export API
 * so that filtering, ledger direction, and reconciliation classification stay
 * consistent between the table view and exported files.
 */

export const LEDGER_TRANSACTION_TYPES = [
  "investment",
  "loan_disbursement",
  "repayment",
  "deposit",
  "withdrawal",
  "return",
  "pool_investment",
  "wallet_funding",
  "wallet_debit",
  "down_payment",
] as const

export type LedgerTransactionType = (typeof LEDGER_TRANSACTION_TYPES)[number]

export const LEDGER_STATUSES = ["Pending", "Completed", "Failed"] as const
export type LedgerStatus = (typeof LEDGER_STATUSES)[number]

export const LEDGER_METHODS = [
  "wallet",
  "internal_wallet",
  "gateway",
  "paystack",
  "privy",
  "system",
] as const
export type LedgerMethod = (typeof LEDGER_METHODS)[number]

export const LEDGER_USER_TYPES = ["driver", "investor", "admin"] as const

/**
 * Reconciliation state is derived from a transaction rather than stored, so the
 * dashboard can surface failed, pending, duplicated, and unreconciled records
 * without a schema migration.
 */
export type ReconciliationStatus = "reconciled" | "pending" | "failed" | "duplicate"

/** Transaction types that increase the user's wallet balance. */
const CREDIT_TYPES = new Set<LedgerTransactionType>([
  "deposit",
  "wallet_funding",
  "return",
  "loan_disbursement",
])

export type LedgerDirection = "credit" | "debit"

export function getLedgerDirection(type: string): LedgerDirection {
  return CREDIT_TYPES.has(type as LedgerTransactionType) ? "credit" : "debit"
}

export function getReconciliationStatus(
  status: string,
  reference: string | null | undefined,
  duplicateReferences: Set<string>,
): ReconciliationStatus {
  if (status === "Failed") return "failed"
  if (status === "Pending") return "pending"
  if (reference && duplicateReferences.has(reference)) return "duplicate"
  return "reconciled"
}

export interface LedgerQueryParams {
  page: number
  pageSize: number
  search: string
  type: string
  status: string
  method: string
  reconciliation: string
  from: string
  to: string
  userType: string
  userId: string
}

export interface LedgerActor {
  id: string
  role: "admin" | "driver" | "investor"
}

/**
 * Builds a MongoDB filter for the ledger. Non-admins are always scoped to their
 * own records; admins may optionally scope by userId/userType.
 */
export function buildLedgerFilter(params: LedgerQueryParams, actor: LedgerActor): Record<string, unknown> {
  const filter: Record<string, unknown> = {}

  if (actor.role === "admin") {
    if (params.userId) filter.userId = params.userId
    if (LEDGER_USER_TYPES.includes(params.userType as (typeof LEDGER_USER_TYPES)[number])) {
      filter.userType = params.userType
    }
  } else {
    filter.userId = actor.id
  }

  if (LEDGER_TRANSACTION_TYPES.includes(params.type as LedgerTransactionType)) {
    filter.type = params.type
  }

  if (LEDGER_STATUSES.includes(params.status as LedgerStatus)) {
    filter.status = params.status
  }

  if (LEDGER_METHODS.includes(params.method as LedgerMethod)) {
    filter.method = params.method
  }

  const timestamp: Record<string, Date> = {}
  if (params.from) {
    const fromDate = new Date(params.from)
    if (!Number.isNaN(fromDate.getTime())) timestamp.$gte = fromDate
  }
  if (params.to) {
    const toDate = new Date(params.to)
    if (!Number.isNaN(toDate.getTime())) {
      toDate.setHours(23, 59, 59, 999)
      timestamp.$lte = toDate
    }
  }
  if (Object.keys(timestamp).length > 0) {
    filter.timestamp = timestamp
  }

  if (params.search) {
    const escaped = params.search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    const regex = new RegExp(escaped, "i")
    filter.$or = [{ description: regex }, { gatewayReference: regex }, { relatedId: regex }]
  }

  return filter
}

export interface NormalizedLedgerEntry {
  id: string
  userId: string
  userType: string
  userName: string | null
  userEmail: string | null
  type: string
  direction: LedgerDirection
  amount: number
  amountOriginal: number | null
  currency: string
  originalCurrency: string | null
  exchangeRate: number | null
  method: string | null
  reference: string | null
  description: string
  status: string
  reconciliation: ReconciliationStatus
  relatedId: string | null
  metadata: Record<string, unknown> | null
  timestamp: string
}

export function normalizeLedgerEntry(
  tx: Record<string, any>,
  duplicateReferences: Set<string>,
): NormalizedLedgerEntry {
  const reference = tx.gatewayReference ?? null
  const status = tx.status ?? "Completed"

  // userId may be a raw ObjectId or a populated user document.
  const userRef = tx.userId
  const isPopulatedUser = userRef && typeof userRef === "object" && "_id" in userRef
  const userId = isPopulatedUser ? userRef._id.toString() : userRef ? userRef.toString() : ""
  const userName = isPopulatedUser ? userRef.fullName ?? userRef.name ?? null : null
  const userEmail = isPopulatedUser ? userRef.email ?? null : null

  return {
    id: tx._id.toString(),
    userId,
    userType: tx.userType ?? "",
    userName,
    userEmail,
    type: tx.type,
    direction: getLedgerDirection(tx.type),
    amount: Number(tx.amount ?? 0),
    amountOriginal: tx.amountOriginal != null ? Number(tx.amountOriginal) : null,
    currency: tx.currency ?? "NGN",
    originalCurrency: tx.originalCurrency ?? null,
    exchangeRate: tx.exchangeRate != null ? Number(tx.exchangeRate) : null,
    method: tx.method ?? null,
    reference,
    description: tx.description ?? "",
    status,
    reconciliation: getReconciliationStatus(status, reference, duplicateReferences),
    relatedId: tx.relatedId ?? null,
    metadata: (tx.metadata as Record<string, unknown> | undefined) ?? null,
    timestamp: tx.timestamp ? new Date(tx.timestamp).toISOString() : new Date().toISOString(),
  }
}
