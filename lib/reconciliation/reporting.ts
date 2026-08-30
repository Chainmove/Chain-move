import { IReconciliationDiscrepancy } from "@/models/ReconciliationDiscrepancy"
import { IReconciliationRun } from "@/models/ReconciliationRun"

const PII_KEYS = ["email", "phone", "phoneNumber", "address", "fullName", "name", "password", "secret"]

/**
 * Recursively redacts sensitive PII fields from strings, arrays, and objects.
 */
export function redactPii<T>(input: T): T {
  if (input === null || input === undefined) return input

  if (typeof input === "string") {
    let redacted = input.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      "[REDACTED_EMAIL]",
    )
    redacted = redacted.replace(
      /(\+?\d{1,3}[-.\s]?)?(\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}/g,
      "[REDACTED_PHONE]",
    )
    return redacted as T
  }

  if (Array.isArray(input)) {
    return input.map((item) => redactPii(item)) as T
  }

  if (typeof input === "object") {
    const output: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
      const isPiiKey = PII_KEYS.some((pii) => key.toLowerCase().includes(pii.toLowerCase()))
      if (isPiiKey) {
        output[key] = "[REDACTED]"
      } else {
        output[key] = redactPii(value)
      }
    }
    return output as T
  }

  return input
}

export interface ReconciliationRunSummary {
  runId: string
  provider: string
  periodStart: string
  periodEnd: string
  status: string
  triggeredBy: string
  operator?: {
    userId?: string
    userAgent?: string
    ipAddress?: string
  }
  totals: {
    providerTotal: number
    internalTotal: number
    discrepancyTotal: number
    remediatedTotal: number
    matchedCount: number
    unmatchedCount: number
  }
  metrics: {
    totalProviderRecords: number
    totalInternalRecords: number
    matchedRecords: number
    discrepancyCount: number
    remediatedCount: number
  }
  totalDiscrepancies: number
  byCategory: Record<string, number>
  byStatus: Record<string, number>
  discrepancies: Array<{
    id: string
    fingerprint: string
    category: string
    providerReference?: string
    providerAmount?: number
    providerStatus?: string
    internalTransactionId?: string
    internalAmount?: number
    internalStatus?: string
    explanation: string
    remediationStatus: string
    createdAt: string
  }>
}

export function generateReconciliationJsonSummary(
  run: IReconciliationRun,
  discrepancies: Array<IReconciliationDiscrepancy | Record<string, any>>,
): ReconciliationRunSummary {
  const summary: ReconciliationRunSummary = {
    runId: run.runId,
    provider: run.provider,
    periodStart: run.periodStart.toISOString(),
    periodEnd: run.periodEnd.toISOString(),
    status: run.status,
    triggeredBy: run.triggeredBy,
    operator: run.operator
      ? {
          userId: run.operator.userId?.toString(),
          userAgent: run.operator.userAgent,
          ipAddress: run.operator.ipAddress,
        }
      : undefined,
    totals: run.totals || {
      providerTotal: 0,
      internalTotal: 0,
      discrepancyTotal: 0,
      remediatedTotal: 0,
      matchedCount: 0,
      unmatchedCount: 0,
    },
    metrics: run.metrics || {
      totalProviderRecords: 0,
      totalInternalRecords: 0,
      matchedRecords: 0,
      discrepancyCount: 0,
      remediatedCount: 0,
    },
    totalDiscrepancies: discrepancies.length,
    byCategory: {},
    byStatus: {},
    discrepancies: [],
  }

  for (const d of discrepancies) {
    const category = d.category || "UNKNOWN"
    const status = d.remediationStatus || "unresolved"

    summary.byCategory[category] = (summary.byCategory[category] || 0) + 1
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1

    summary.discrepancies.push({
      id: d._id ? d._id.toString() : d.id || "",
      fingerprint: d.fingerprint,
      category,
      providerReference: d.providerReference,
      providerAmount: d.providerAmount,
      providerStatus: d.providerStatus,
      internalTransactionId: d.internalTransactionId,
      internalAmount: d.internalAmount,
      internalStatus: d.internalStatus,
      explanation: redactPii(d.explanation || ""),
      remediationStatus: status,
      createdAt: d.createdAt ? new Date(d.createdAt).toISOString() : new Date().toISOString(),
    })
  }

  return summary
}

export function generateReconciliationCsvExport(
  discrepancies: Array<IReconciliationDiscrepancy | Record<string, any>>,
): string {
  const headers = [
    "ID",
    "Fingerprint",
    "RunID",
    "Category",
    "ProviderReference",
    "ProviderAmount",
    "ProviderStatus",
    "InternalTransactionID",
    "InternalAmount",
    "InternalStatus",
    "RemediationStatus",
    "Explanation",
  ]

  const rows = discrepancies.map((d) => {
    const id = d._id ? d._id.toString() : d.id || ""
    const explanation = redactPii(d.explanation || "").replace(/"/g, '""')
    return [
      `"${id}"`,
      `"${d.fingerprint || ""}"`,
      `"${d.runId || ""}"`,
      `"${d.category || ""}"`,
      `"${d.providerReference || ""}"`,
      d.providerAmount || 0,
      `"${d.providerStatus || ""}"`,
      `"${d.internalTransactionId || ""}"`,
      d.internalAmount || 0,
      `"${d.internalStatus || ""}"`,
      `"${d.remediationStatus || "unresolved"}"`,
      `"${explanation}"`,
    ].join(",")
  })

  return [headers.join(","), ...rows].join("\n")
}

export function generateReconciliationRunCsvExport(runs: IReconciliationRun[]): string {
  const headers = [
    "RunID",
    "Provider",
    "PeriodStart",
    "PeriodEnd",
    "Status",
    "TriggeredBy",
    "OperatorUserId",
    "ProviderTotal",
    "InternalTotal",
    "DiscrepancyTotal",
    "RemediatedTotal",
    "MatchedCount",
    "UnmatchedCount",
    "TotalProviderRecords",
    "TotalInternalRecords",
    "MatchedRecords",
    "DiscrepancyCount",
    "RemediatedCount",
    "ErrorMessage",
  ]

  const rows = runs.map((r) => [
    `"${r.runId}"`,
    `"${r.provider}"`,
    r.periodStart.toISOString(),
    r.periodEnd.toISOString(),
    `"${r.status}"`,
    `"${r.triggeredBy}"`,
    r.operator?.userId ? `"${r.operator.userId}"` : "",
    r.totals?.providerTotal || 0,
    r.totals?.internalTotal || 0,
    r.totals?.discrepancyTotal || 0,
    r.totals?.remediatedTotal || 0,
    r.totals?.matchedCount || 0,
    r.totals?.unmatchedCount || 0,
    r.metrics?.totalProviderRecords || 0,
    r.metrics?.totalInternalRecords || 0,
    r.metrics?.matchedRecords || 0,
    r.metrics?.discrepancyCount || 0,
    r.metrics?.remediatedCount || 0,
    `"${(r.errorMessage || "").replace(/"/g, '""')}"`,
  ])

  return [headers.join(","), ...rows].join("\n")
}
