import crypto from "crypto"
import mongoose from "mongoose"
import dbConnect from "@/lib/dbConnect"
import ReconciliationRun, {
  IReconciliationRun,
  IReconciliationRunOperator,
  IReconciliationRunTotals,
} from "@/models/ReconciliationRun"
import ReconciliationDiscrepancy, {
  DiscrepancyCategory,
  IReconciliationDiscrepancy,
  RemediationStatus,
} from "@/models/ReconciliationDiscrepancy"
import ProcessedGatewayEvent from "@/models/ProcessedGatewayEvent"
import Transaction from "@/models/Transaction"
import DriverPayment from "@/models/DriverPayment"
import DriverVirtualAccount from "@/models/DriverVirtualAccount"
import InvestorVirtualAccount from "@/models/InvestorVirtualAccount"
import User from "@/models/User"
import AuditLog from "@/models/AuditLog"
import {
  IPaystackAdapter,
  PaystackTransactionRecord,
  NormalizedPaystackTransaction,
} from "@/lib/paystack/types"

/**
 * Computes deterministic SHA-256 hash fingerprint for discrepancy deduplication across re-runs.
 */
export function createDiscrepancyFingerprint(
  category: DiscrepancyCategory,
  providerRef = "",
  internalTxId = "",
  amount = 0,
): string {
  const raw = `${category}:${providerRef}:${internalTxId}:${amount}`
  return crypto.createHash("sha256").update(raw).digest("hex")
}

export interface ReconciliationRunResult {
  run: IReconciliationRun
  discrepancies: IReconciliationDiscrepancy[]
}

export interface ReconciliationOperator {
  userId?: string
  userAgent?: string
  ipAddress?: string
}

export interface ReconciliationOptions {
  periodStart: Date
  periodEnd: Date
  adapter: IPaystackAdapter
  triggeredBy?: string
  operator?: ReconciliationOperator
  normalizedTransactions?: NormalizedPaystackTransaction[]
}

/**
 * Converts a NormalizedPaystackTransaction into a PaystackTransactionRecord
 * shape suitable for reconciliation comparison.
 */
function normalizedToProviderRecord(
  tx: NormalizedPaystackTransaction,
): PaystackTransactionRecord {
  return {
    id: 0,
    domain: "custom",
    status: tx.status,
    reference: tx.reference,
    amount: tx.amount * 100,
    gateway_response: "Normalized",
    created_at: tx.createdAt,
    paid_at: tx.paidAt,
    channel: tx.channel || "custom",
    currency: tx.currency || "NGN",
    customer: tx.customerEmail
      ? {
          id: 0,
          email: tx.customerEmail,
          customer_code: "",
          first_name: tx.customerName?.split(" ")[0] || "",
          last_name: tx.customerName?.split(" ").slice(1).join(" ") || "",
        }
      : undefined,
    dedicated_account: tx.dedicatedAccountNumber
      ? {
          account_number: tx.dedicatedAccountNumber,
          account_name: "",
          bank_name: "",
        }
      : undefined,
  }
}

/**
 * Executes Paystack-to-ledger settlement reconciliation over specified date window.
 */
export async function runReconciliation(
  options: ReconciliationOptions,
): Promise<ReconciliationRunResult> {
  const {
    periodStart,
    periodEnd,
    adapter,
    triggeredBy = "system",
    operator,
    normalizedTransactions,
  } = options

  await dbConnect()

  const runId = `RECON-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
  const runDoc = await ReconciliationRun.create({
    runId,
    provider: "paystack",
    periodStart,
    periodEnd,
    status: "in_progress",
    triggeredBy,
    startedAt: new Date(),
    operator: operator
      ? {
          userId: operator.userId ? (operator.userId as any) : undefined,
          userAgent: operator.userAgent,
          ipAddress: operator.ipAddress,
        }
      : undefined,
  })

  let providerTotal = 0
  let internalTotal = 0
  let discrepancyTotal = 0
  let remediatedTotal = 0
  let matchedCount = 0
  let unmatchedCount = 0

  try {
    // 1. Fetch provider transaction records with pagination
    let page = 1
    const perPage = 50
    let allProviderRecords: PaystackTransactionRecord[] = []
    let hasMore = true

    while (hasMore) {
      const resp = await adapter.fetchTransactions({
        from: periodStart.toISOString(),
        to: periodEnd.toISOString(),
        page,
        perPage,
      })

      allProviderRecords = allProviderRecords.concat(resp.data || [])
      if (!resp.meta || page >= resp.meta.pageCount) {
        hasMore = false
      } else {
        page++
      }
    }

    // 1b. Merge normalized transactions if provided
    if (normalizedTransactions && normalizedTransactions.length > 0) {
      for (const ntx of normalizedTransactions) {
        const alreadyExists = allProviderRecords.some(
          (r) => r.reference === ntx.reference,
        )
        if (!alreadyExists) {
          allProviderRecords.push(normalizedToProviderRecord(ntx))
        }
      }
    }

    // 2. Fetch internal records within date window
    const internalTxs = await Transaction.find({
      timestamp: { $gte: periodStart, $lte: periodEnd },
    }).lean()

    const processedEvents = await ProcessedGatewayEvent.find({
      createdAt: { $gte: periodStart, $lte: periodEnd },
    }).lean()

    const driverPayments = await DriverPayment.find({
      paymentDate: { $gte: periodStart, $lte: periodEnd },
    }).lean()

    const driverDvas = await DriverVirtualAccount.find({}).lean()
    const investorDvas = await InvestorVirtualAccount.find({}).lean()
    const users = await User.find({}).lean()

    // Fast lookup maps
    const internalByRef = new Map<string, any>()
    for (const tx of internalTxs) {
      if (tx.gatewayReference) {
        internalByRef.set(tx.gatewayReference, tx)
      }
    }

    const driverPaymentByRef = new Map<string, any>()
    for (const dp of driverPayments) {
      if (dp.paystackRef) {
        driverPaymentByRef.set(dp.paystackRef, dp)
      }
    }

    const processedEventIds = new Set<string>(processedEvents.map((e) => e._id))

    // Track provider references for duplicate detection
    const providerRefCounts = new Map<string, number>()
    for (const pRec of allProviderRecords) {
      if (pRec.reference) {
        providerRefCounts.set(pRec.reference, (providerRefCounts.get(pRec.reference) || 0) + 1)
      }
    }

    // Track internal gateway references for duplicate detection
    const internalRefCounts = new Map<string, number>()
    for (const tx of internalTxs) {
      if (tx.gatewayReference) {
        internalRefCounts.set(tx.gatewayReference, (internalRefCounts.get(tx.gatewayReference) || 0) + 1)
      }
    }

    // Track DVA account numbers
    const dvaAccountNumbers = new Set<string>()
    for (const dva of driverDvas) {
      if (dva.accountNumber) dvaAccountNumbers.add(dva.accountNumber)
    }
    for (const dva of investorDvas) {
      if (dva.accountNumber) dvaAccountNumbers.add(dva.accountNumber)
    }

    const discrepanciesToSave: Array<Partial<IReconciliationDiscrepancy>> = []

    // 3. Compare Provider Records -> Internal Records
    for (const pRec of allProviderRecords) {
      const pRef = pRec.reference
      const pAmountNgn = pRec.amount / 100
      const pStatus = pRec.status

      providerTotal += pAmountNgn

      // Check DUPLICATE_PROVIDER_RECORD
      if (providerRefCounts.get(pRef)! > 1) {
        const fp = createDiscrepancyFingerprint("DUPLICATE_PROVIDER_RECORD", pRef, "", pAmountNgn)
        discrepanciesToSave.push({
          fingerprint: fp,
          runId,
          category: "DUPLICATE_PROVIDER_RECORD",
          providerReference: pRef,
          providerAmount: pAmountNgn,
          providerCurrency: pRec.currency,
          providerStatus: pStatus,
          providerCustomerEmail: pRec.customer?.email,
          explanation: `Paystack reported duplicate reference '${pRef}' across multiple transaction entries`,
        })
        unmatchedCount++
        continue
      }

      // Check UNKNOWN_ACCOUNT if dedicated account transfer
      const dvaNumber = pRec.dedicated_account?.account_number
      if (dvaNumber) {
        const foundDriverDva = driverDvas.find((d) => d.accountNumber === dvaNumber)
        const foundInvestorDva = investorDvas.find((i) => i.accountNumber === dvaNumber)
        if (!foundDriverDva && !foundInvestorDva) {
          const fp = createDiscrepancyFingerprint("UNKNOWN_ACCOUNT", pRef, "", pAmountNgn)
          discrepanciesToSave.push({
            fingerprint: fp,
            runId,
            category: "UNKNOWN_ACCOUNT",
            providerReference: pRef,
            providerAmount: pAmountNgn,
            providerDedicatedAccount: dvaNumber,
            providerCustomerEmail: pRec.customer?.email,
            explanation: `Dedicated account transfer to '${dvaNumber}' does not match any registered driver or investor virtual account`,
          })
          unmatchedCount++
          continue
        }
      }

      const matchingTx = internalByRef.get(pRef)
      const matchingDp = driverPaymentByRef.get(pRef)
      const matchingEventId = processedEventIds.has(pRef)

      if (!matchingTx && !matchingDp && !matchingEventId) {
        // MISSING_INTERNAL_RECORD
        const fp = createDiscrepancyFingerprint("MISSING_INTERNAL_RECORD", pRef, "", pAmountNgn)
        discrepanciesToSave.push({
          fingerprint: fp,
          runId,
          category: "MISSING_INTERNAL_RECORD",
          providerReference: pRef,
          providerAmount: pAmountNgn,
          providerCurrency: pRec.currency,
          providerStatus: pStatus,
          providerCustomerEmail: pRec.customer?.email,
          explanation: `Provider transaction '${pRef}' of NGN ${pAmountNgn} has no corresponding internal Transaction or DriverPayment record`,
        })
        discrepancyTotal += pAmountNgn
        unmatchedCount++
      } else {
        matchedCount++

        const intTx = matchingTx || matchingDp
        const intAmount = intTx ? intTx.amount || intTx.amountPaidNgn : 0
        const intStatus = intTx ? intTx.status : "Completed"
        internalTotal += intAmount

        // Check AMOUNT_MISMATCH
        if (intTx && Math.abs(intAmount - pAmountNgn) > 0.01) {
          const intId = intTx._id.toString()
          const fp = createDiscrepancyFingerprint("AMOUNT_MISMATCH", pRef, intId, pAmountNgn)
          discrepanciesToSave.push({
            fingerprint: fp,
            runId,
            category: "AMOUNT_MISMATCH",
            providerReference: pRef,
            providerAmount: pAmountNgn,
            internalTransactionId: intId,
            internalAmount: intAmount,
            explanation: `Paystack settled amount (NGN ${pAmountNgn}) does not match internal record amount (NGN ${intAmount})`,
          })
          discrepancyTotal += Math.abs(intAmount - pAmountNgn)
        }

        // Check STATUS_MISMATCH
        const pSuccess = pStatus === "success"
        const intSuccess = intStatus === "Completed"
        if (intTx && pSuccess !== intSuccess) {
          const intId = intTx._id.toString()
          const fp = createDiscrepancyFingerprint("STATUS_MISMATCH", pRef, intId, pAmountNgn)
          discrepanciesToSave.push({
            fingerprint: fp,
            runId,
            category: "STATUS_MISMATCH",
            providerReference: pRef,
            providerAmount: pAmountNgn,
            providerStatus: pStatus,
            internalTransactionId: intId,
            internalStatus: intStatus,
            explanation: `Paystack status is '${pStatus}' but internal transaction status is '${intStatus}'`,
          })
          discrepancyTotal += pAmountNgn
        }

        // Check REVERSAL_REFUND
        if (pStatus === "reversed" && intSuccess) {
          const intId = intTx._id.toString()
          const fp = createDiscrepancyFingerprint("REVERSAL_REFUND", pRef, intId, pAmountNgn)
          discrepanciesToSave.push({
            fingerprint: fp,
            runId,
            category: "REVERSAL_REFUND",
            providerReference: pRef,
            providerAmount: pAmountNgn,
            providerStatus: pStatus,
            internalTransactionId: intId,
            internalStatus: intStatus,
            explanation: `Paystack transaction '${pRef}' was reversed/refunded after internal transaction was completed`,
          })
          discrepancyTotal += pAmountNgn
        }

        // Check OWNER_MISMATCH if customer email differs from internal user
        if (pRec.customer?.email && intTx && intTx.userId) {
          const userObj = users.find((u) => u._id.toString() === intTx.userId.toString())
          if (userObj && userObj.email && userObj.email.toLowerCase() !== pRec.customer.email.toLowerCase()) {
            const intId = intTx._id.toString()
            const fp = createDiscrepancyFingerprint("OWNER_MISMATCH", pRef, intId, pAmountNgn)
            discrepanciesToSave.push({
              fingerprint: fp,
              runId,
              category: "OWNER_MISMATCH",
              providerReference: pRef,
              providerAmount: pAmountNgn,
              providerCustomerEmail: pRec.customer.email,
              internalTransactionId: intId,
              explanation: `Paystack customer email '${pRec.customer.email}' does not match internal record user email '${userObj.email}'`,
            })
            discrepancyTotal += pAmountNgn
          }
        }
      }
    }

    // 4. Compare Internal Records -> Provider Records
    const providerRefMap = new Map<string, PaystackTransactionRecord>()
    for (const pRec of allProviderRecords) {
      if (pRec.reference) {
        providerRefMap.set(pRec.reference, pRec)
      }
    }

    const now = new Date().getTime()
    for (const tx of internalTxs) {
      const gRef = tx.gatewayReference
      internalTotal += tx.amount || 0

      if (gRef && !providerRefMap.has(gRef)) {
        // MISSING_PROVIDER_RECORD
        const txId = tx._id.toString()
        const fp = createDiscrepancyFingerprint("MISSING_PROVIDER_RECORD", gRef, txId, tx.amount)
        discrepanciesToSave.push({
          fingerprint: fp,
          runId,
          category: "MISSING_PROVIDER_RECORD",
          providerReference: gRef,
          internalTransactionId: txId,
          internalAmount: tx.amount,
          internalStatus: tx.status,
          explanation: `Internal transaction '${txId}' has gateway reference '${gRef}' but Paystack returned no matching transaction record`,
        })
        discrepancyTotal += tx.amount || 0
        unmatchedCount++
      }

      // Check DUPLICATE_INTERNAL_RECORD
      if (gRef && internalRefCounts.get(gRef)! > 1) {
        const txId = tx._id.toString()
        const fp = createDiscrepancyFingerprint("DUPLICATE_INTERNAL_RECORD", gRef, txId, tx.amount)
        discrepanciesToSave.push({
          fingerprint: fp,
          runId,
          category: "DUPLICATE_INTERNAL_RECORD",
          providerReference: gRef,
          internalTransactionId: txId,
          internalAmount: tx.amount,
          internalStatus: tx.status,
          explanation: `Internal transaction '${txId}' has duplicate gateway reference '${gRef}' across multiple internal records`,
        })
        discrepancyTotal += tx.amount || 0
        unmatchedCount++
      }

      // Check INTERNAL_LEDGER_MISMATCH (amount doesn't match expected ledger balance)
      if (gRef && providerRefMap.has(gRef)) {
        const pRec = providerRefMap.get(gRef)!
        const pAmountNgn = pRec.amount / 100
        if (Math.abs((tx.amount || 0) - pAmountNgn) > 0.01) {
          const txId = tx._id.toString()
          const fp = createDiscrepancyFingerprint("INTERNAL_LEDGER_MISMATCH", gRef, txId, tx.amount || 0)
          discrepanciesToSave.push({
            fingerprint: fp,
            runId,
            category: "INTERNAL_LEDGER_MISMATCH",
            providerReference: gRef,
            internalTransactionId: txId,
            internalAmount: tx.amount || 0,
            providerAmount: pAmountNgn,
            internalStatus: tx.status,
            explanation: `Internal ledger amount (NGN ${tx.amount}) does not match Paystack settled amount (NGN ${pAmountNgn}) for reference '${gRef}'`,
          })
          discrepancyTotal += Math.abs((tx.amount || 0) - pAmountNgn)
          unmatchedCount++
        }
      }

      // Check STALE_PENDING (>24 hours in Pending status)
      if (tx.status === "Pending") {
        const ageHours = (now - new Date(tx.timestamp).getTime()) / (1000 * 60 * 60)
        if (ageHours > 24) {
          const txId = tx._id.toString()
          const fp = createDiscrepancyFingerprint("STALE_PENDING", gRef || "", txId, tx.amount)
          discrepanciesToSave.push({
            fingerprint: fp,
            runId,
            category: "STALE_PENDING",
            providerReference: gRef,
            internalTransactionId: txId,
            internalAmount: tx.amount,
            internalStatus: tx.status,
            explanation: `Internal transaction '${txId}' has been in 'Pending' status for ${Math.round(ageHours)} hours`,
          })
          discrepancyTotal += tx.amount || 0
          unmatchedCount++
        }
      }
    }

    // 5. Idempotently save discrepancies using fingerprint deduplication
    const savedDiscrepancies: IReconciliationDiscrepancy[] = []
    for (const disc of discrepanciesToSave) {
      const upserted = await ReconciliationDiscrepancy.findOneAndUpdate(
        { fingerprint: disc.fingerprint },
        { $setOnInsert: { ...disc, remediationStatus: "unresolved" } },
        { upsert: true, new: true, setDefaultsOnInsert: true },
      )
      savedDiscrepancies.push(upserted)
    }

    // 6. Count remediated discrepancies
    const remediatedCount = await ReconciliationDiscrepancy.countDocuments({
      runId,
      remediationStatus: { $in: ["manually_resolved", "auto_remediated"] },
    })
    remediatedTotal = savedDiscrepancies
      .filter((d) => d.remediationStatus === "manually_resolved" || d.remediationStatus === "auto_remediated")
      .reduce((sum, d) => sum + (d.providerAmount || d.internalAmount || 0), 0)

    // 7. Update Reconciliation Run document with totals and metrics
    runDoc.status = "completed"
    runDoc.completedAt = new Date()
    runDoc.totals = {
      providerTotal,
      internalTotal,
      discrepancyTotal,
      remediatedTotal,
      matchedCount,
      unmatchedCount,
    }
    runDoc.metrics = {
      totalProviderRecords: allProviderRecords.length,
      totalInternalRecords: internalTxs.length,
      matchedRecords: matchedCount,
      discrepancyCount: savedDiscrepancies.length,
      remediatedCount,
    }
    await runDoc.save()

    return { run: runDoc, discrepancies: savedDiscrepancies }
  } catch (error: any) {
    runDoc.status = "failed"
    runDoc.completedAt = new Date()
    runDoc.errorMessage = error.message || "Reconciliation run failed"
    await runDoc.save()
    throw error
  }
}

/**
 * Accepts normalized Paystack transaction data through the provider adapter
 * for reconciliation without fetching from the live API.
 */
export async function runReconciliationWithNormalizedData(
  periodStart: Date,
  periodEnd: Date,
  adapter: IPaystackAdapter,
  normalizedTransactions: NormalizedPaystackTransaction[],
  triggeredBy = "system",
  operator?: ReconciliationOperator,
): Promise<ReconciliationRunResult> {
  const validation = await adapter.acceptNormalizedTransactions({
    transactions: normalizedTransactions,
    receivedAt: new Date().toISOString(),
  })

  if (validation.rejected > 0) {
    const runId = `RECON-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`
    const runDoc = await ReconciliationRun.create({
      runId,
      provider: "paystack",
      periodStart,
      periodEnd,
      status: "failed",
      triggeredBy,
      startedAt: new Date(),
      completedAt: new Date(),
      operator: operator
        ? {
            userId: operator.userId ? (operator.userId as any) : undefined,
            userAgent: operator.userAgent,
            ipAddress: operator.ipAddress,
          }
        : undefined,
      totals: {
        providerTotal: 0,
        internalTotal: 0,
        discrepancyTotal: 0,
        remediatedTotal: 0,
        matchedCount: 0,
        unmatchedCount: 0,
      },
      metrics: {
        totalProviderRecords: 0,
        totalInternalRecords: 0,
        matchedRecords: 0,
        discrepancyCount: 0,
        remediatedCount: 0,
      },
      errorMessage: `Normalized data validation rejected ${validation.rejected} transactions: ${validation.errors.join("; ")}`,
    })

    return { run: runDoc, discrepancies: [] }
  }

  return runReconciliation({
    periodStart,
    periodEnd,
    adapter,
    triggeredBy,
    operator,
    normalizedTransactions,
  })
}

export type RemediationAction =
  | "RECONCILE_CREATE_TRANSACTION"
  | "RECONCILE_POST_REVERSAL"
  | "RECONCILE_UPDATE_STATUS"
  | "IGNORE"

export interface RemediationPreview {
  discrepancyId: string
  category: DiscrepancyCategory
  action: RemediationAction
  before: Record<string, unknown>
  after: Record<string, unknown>
}

const CORRECTION_DESCRIPTION_PREFIX = "Reconciliation correction for missing Paystack reference"

/**
 * Computes the before/after preview for a remediation action without
 * mutating any state. Used by the maker-checker approval flow to show a
 * requester and approver exactly what a remediation will do before it runs.
 */
export async function previewRemediation(
  discrepancyId: string,
  action: RemediationAction,
): Promise<RemediationPreview> {
  await dbConnect()

  const discrepancy = await ReconciliationDiscrepancy.findById(discrepancyId).lean()
  if (!discrepancy) {
    throw new Error(`Reconciliation discrepancy ${discrepancyId} not found`)
  }
  if (discrepancy.remediationStatus !== "unresolved") {
    throw new Error(`Discrepancy ${discrepancyId} is already resolved (${discrepancy.remediationStatus})`)
  }

  const before: Record<string, unknown> = {
    remediationStatus: discrepancy.remediationStatus,
    category: discrepancy.category,
    providerReference: discrepancy.providerReference ?? null,
    providerAmount: discrepancy.providerAmount ?? null,
    internalTransactionId: discrepancy.internalTransactionId ?? null,
  }
  const after: Record<string, unknown> = {
    remediationStatus: action === "IGNORE" ? "ignored" : "manually_resolved",
  }

  if (action === "RECONCILE_CREATE_TRANSACTION" && discrepancy.category === "MISSING_INTERNAL_RECORD") {
    after.newTransaction = {
      type: "wallet_funding",
      amount: discrepancy.providerAmount || 0,
      currency: discrepancy.providerCurrency || "NGN",
      gatewayReference: discrepancy.providerReference ?? null,
    }
  } else if (action === "RECONCILE_POST_REVERSAL" && discrepancy.internalTransactionId) {
    const origTx = await Transaction.findById(discrepancy.internalTransactionId).lean()
    after.reversalTransaction = {
      type: "wallet_debit",
      amount: discrepancy.providerAmount || origTx?.amount || 0,
      relatedId: discrepancy.internalTransactionId,
    }
  } else if (action === "RECONCILE_UPDATE_STATUS" && discrepancy.internalTransactionId) {
    after.transactionStatus = discrepancy.providerStatus === "success" ? "Completed" : "Failed"
  }

  return { discrepancyId, category: discrepancy.category, action, before, after }
}

/**
 * Safely remediates a discrepancy with elevated authorization and immutable counter-adjustment audit history.
 *
 * Runs inside a Mongoose session/transaction when the deployment's MongoDB
 * supports one (replica set); falls back to sequential writes on a
 * standalone instance, matching the pattern in `lib/integrity/repairEngine.ts`.
 */
export async function remediateDiscrepancy(
  discrepancyId: string,
  action: RemediationAction,
  reviewerUserId: string,
  notes: string,
): Promise<IReconciliationDiscrepancy> {
  await dbConnect()

  const discrepancy = await ReconciliationDiscrepancy.findById(discrepancyId)
  if (!discrepancy) {
    throw new Error(`Reconciliation discrepancy ${discrepancyId} not found`)
  }

  if (discrepancy.remediationStatus !== "unresolved") {
    throw new Error(`Discrepancy ${discrepancyId} is already resolved (${discrepancy.remediationStatus})`)
  }

  let session: mongoose.ClientSession | null = null
  try {
    session = await mongoose.startSession()
    session.startTransaction()
  } catch {
    session = null
  }

  try {
    const opts = session ? { session } : {}
    let auditAction = ""

    if (action === "RECONCILE_CREATE_TRANSACTION") {
      if (discrepancy.category === "MISSING_INTERNAL_RECORD") {
        // Idempotency guard: if a prior attempt already created the correction
        // transaction but failed before the discrepancy could be saved as
        // resolved, reuse it instead of posting a duplicate credit.
        const existingTx = discrepancy.providerReference
          ? await Transaction.findOne({
              gatewayReference: discrepancy.providerReference,
              description: `${CORRECTION_DESCRIPTION_PREFIX} ${discrepancy.providerReference}`,
            }).session(session)
          : null

        if (existingTx) {
          discrepancy.internalTransactionId = existingTx._id.toString()
          auditAction = `RECONCILE_CREATE_TRANSACTION: Reused existing transaction ${existingTx._id}`
        } else {
          const systemUser = await User.findOne({ role: "admin" }).session(session)
          const userId = systemUser ? systemUser._id : reviewerUserId

          const [newTx] = await Transaction.create(
            [
              {
                userId,
                userType: "admin",
                type: "wallet_funding",
                amount: discrepancy.providerAmount || 0,
                currency: discrepancy.providerCurrency || "NGN",
                method: "paystack",
                gatewayReference: discrepancy.providerReference,
                description: `${CORRECTION_DESCRIPTION_PREFIX} ${discrepancy.providerReference}`,
                status: "Completed",
                timestamp: new Date(),
              },
            ],
            opts,
          )

          discrepancy.internalTransactionId = newTx._id.toString()
          auditAction = `RECONCILE_CREATE_TRANSACTION: Created transaction ${newTx._id}`
        }
      }
    } else if (action === "RECONCILE_POST_REVERSAL") {
      if (discrepancy.internalTransactionId) {
        const origTx = await Transaction.findById(discrepancy.internalTransactionId).session(session)
        if (origTx) {
          const [revTx] = await Transaction.create(
            [
              {
                userId: origTx.userId,
                userType: origTx.userType,
                type: "wallet_debit",
                amount: discrepancy.providerAmount || origTx.amount,
                currency: origTx.currency || "NGN",
                method: "system",
                gatewayReference: `REV-${discrepancy.providerReference || origTx.gatewayReference}`,
                description: `Reconciliation reversal counter-adjustment for ${discrepancy.providerReference || origTx._id}`,
                status: "Completed",
                relatedId: origTx._id.toString(),
                timestamp: new Date(),
              },
            ],
            opts,
          )

          auditAction = `RECONCILE_POST_REVERSAL: Posted counter-debit transaction ${revTx._id}`
        }
      }
    } else if (action === "RECONCILE_UPDATE_STATUS") {
      if (discrepancy.internalTransactionId) {
        const tx = await Transaction.findById(discrepancy.internalTransactionId).session(session)
        if (tx) {
          tx.status = discrepancy.providerStatus === "success" ? "Completed" : "Failed"
          await tx.save(opts)
          auditAction = `RECONCILE_UPDATE_STATUS: Updated transaction ${tx._id} status to ${tx.status}`
        }
      }
    } else if (action === "IGNORE") {
      auditAction = "IGNORE: Marked discrepancy as ignored by reviewer"
    }

    const [auditEntry] = await AuditLog.create(
      [
        {
          userId: reviewerUserId,
          action: "RECONCILIATION_REMEDIATE",
          targetModel: "ReconciliationDiscrepancy",
          targetId: discrepancy._id,
          details: {
            action,
            category: discrepancy.category,
            providerReference: discrepancy.providerReference,
            notes,
            auditAction,
          },
          timestamp: new Date(),
        },
      ],
      opts,
    )

    discrepancy.remediationStatus = action === "IGNORE" ? "ignored" : "manually_resolved"
    discrepancy.resolutionNotes = notes
    discrepancy.resolvedByUserId = reviewerUserId as any
    discrepancy.resolvedAt = new Date()
    discrepancy.resolutionAction = auditAction
    discrepancy.auditLogId = auditEntry._id as any

    await discrepancy.save(opts)

    if (session) {
      await session.commitTransaction()
      session.endSession()
    }

    return discrepancy
  } catch (error) {
    if (session) {
      await session.abortTransaction()
      session.endSession()
    }
    throw error
  }
}