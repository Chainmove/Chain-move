import { IInvariantFinding } from "@/models/InvariantFinding"

/**
 * PII fields to sanitize in details and explanations
 */
const PII_KEYS = [
  "email",
  "phone",
  "phoneNumber",
  "address",
  "fullName",
  "name",
  "password",
  "privyUserId",
  "token",
  "secret",
]

/**
 * Recursively redacts PII from objects, arrays, and primitive strings.
 */
export function redactPii<T>(input: T): T {
  if (input === null || input === undefined) {
    return input
  }

  if (typeof input === "string") {
    // Redact email patterns
    let redacted = input.replace(
      /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      "[REDACTED_EMAIL]",
    )
    // Redact phone-like patterns
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
      const isPiiKey = PII_KEYS.some((pii) =>
        key.toLowerCase().includes(pii.toLowerCase()),
      )
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

export interface IntegrityReportSummary {
  timestamp: string
  totalFindings: number
  bySeverity: Record<string, number>
  byCategory: Record<string, number>
  byStatus: Record<string, number>
  byRepairability: Record<string, number>
  findings: Array<{
    id: string
    fingerprint: string
    ruleId: string
    severity: string
    category: string
    primaryModel: string
    primaryId: string
    relatedModel?: string
    relatedId?: string
    explanation: string
    repairability: string
    status: string
    firstSeenAt: string
    lastSeenAt: string
    scanCount: number
    details?: Record<string, unknown>
  }>
}

/**
 * Generates a JSON summary object with PII redacted.
 */
export function generateJsonSummary(
  findings: Array<IInvariantFinding | Record<string, any>>,
): IntegrityReportSummary {
  const summary: IntegrityReportSummary = {
    timestamp: new Date().toISOString(),
    totalFindings: findings.length,
    bySeverity: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 },
    byCategory: {
      REFERENTIAL: 0,
      STATUS_CONTRADICTION: 0,
      FINANCIAL_MISMATCH: 0,
      DUPLICATE_IDENTIFIER: 0,
      SCHEMA_DEPRECATION: 0,
    },
    byStatus: { OPEN: 0, ACKNOWLEDGED: 0, SUPPRESSED: 0, REPAIRED: 0, FAILED: 0 },
    byRepairability: { AUTOMATIC: 0, STRATEGY_REQUIRED: 0, MANUAL_ONLY: 0 },
    findings: [],
  }

  for (const f of findings) {
    const severity = f.severity || "LOW"
    const category = f.category || "REFERENTIAL"
    const status = f.status || "OPEN"
    const repairability = f.repairability || "MANUAL_ONLY"

    summary.bySeverity[severity] = (summary.bySeverity[severity] || 0) + 1
    summary.byCategory[category] = (summary.byCategory[category] || 0) + 1
    summary.byStatus[status] = (summary.byStatus[status] || 0) + 1
    summary.byRepairability[repairability] =
      (summary.byRepairability[repairability] || 0) + 1

    summary.findings.push({
      id: f._id ? f._id.toString() : f.id || "",
      fingerprint: f.fingerprint,
      ruleId: f.ruleId,
      severity,
      category,
      primaryModel: f.primaryModel,
      primaryId: f.primaryId,
      relatedModel: f.relatedModel,
      relatedId: f.relatedId,
      explanation: redactPii(f.explanation),
      repairability,
      status,
      firstSeenAt: f.firstSeenAt ? new Date(f.firstSeenAt).toISOString() : new Date().toISOString(),
      lastSeenAt: f.lastSeenAt ? new Date(f.lastSeenAt).toISOString() : new Date().toISOString(),
      scanCount: f.scanCount || 1,
      details: f.details ? redactPii(f.details) : undefined,
    })
  }

  return summary
}

/**
 * Generates CSV string format for findings.
 */
export function generateCsvExport(
  findings: Array<IInvariantFinding | Record<string, any>>,
): string {
  const headers = [
    "ID",
    "Fingerprint",
    "RuleID",
    "Severity",
    "Category",
    "PrimaryModel",
    "PrimaryID",
    "RelatedModel",
    "RelatedID",
    "Repairability",
    "Status",
    "ScanCount",
    "FirstSeenAt",
    "LastSeenAt",
    "Explanation",
  ]

  const rows = findings.map((f) => {
    const id = f._id ? f._id.toString() : f.id || ""
    const explanation = redactPii(f.explanation || "").replace(/"/g, '""')
    return [
      `"${id}"`,
      `"${f.fingerprint || ""}"`,
      `"${f.ruleId || ""}"`,
      `"${f.severity || ""}"`,
      `"${f.category || ""}"`,
      `"${f.primaryModel || ""}"`,
      `"${f.primaryId || ""}"`,
      `"${f.relatedModel || ""}"`,
      `"${f.relatedId || ""}"`,
      `"${f.repairability || ""}"`,
      `"${f.status || ""}"`,
      f.scanCount || 1,
      `"${f.firstSeenAt ? new Date(f.firstSeenAt).toISOString() : ""}"`,
      `"${f.lastSeenAt ? new Date(f.lastSeenAt).toISOString() : ""}"`,
      `"${explanation}"`,
    ].join(",")
  })

  return [headers.join(","), ...rows].join("\n")
}
