export type RiskSeverity = "low" | "medium" | "high" | "critical"
export type RiskEvent = {
  id: string
  type: string
  subjectId: string
  occurredAt: Date
  attributes: Record<string, unknown>
}
export type RiskRule = {
  code: string
  version: number
  category: string
  severity: RiskSeverity
  enabled: boolean
  eventTypes: string[]
  effectiveFrom: Date
  effectiveUntil?: Date
  cooldownMs?: number
  evaluate: (event: RiskEvent) => { matched: boolean; explanation: string; evidence: string[] }
}
export type RiskSignal = {
  dedupeKey: string
  eventId: string
  subjectId: string
  ruleCode: string
  ruleVersion: number
  category: string
  severity: RiskSeverity
  explanation: string
  evidence: string[]
  eventTime: Date
  evaluatedAt: Date
}

export type Suppression = {
  ruleCode: string
  subjectId?: string
  reason: string
  expiresAt: Date
}

export const INITIAL_RISK_RULES: RiskRule[] = [
  countRule("PAYMENT_FAILURE_BURST", "payments", "high", "payment.failed", "failedAttempts", 3),
  amountRule("UNUSUAL_WALLET_FUNDING", "wallet", "high", "wallet.funded", "amount", 1_000_000),
  booleanRule("AMOUNT_IDENTITY_MISMATCH", "identity", "critical", "payment.requested", "identityMismatch"),
  booleanRule("DUPLICATE_REFERENCE", "payments", "high", "payment.requested", "duplicateReference"),
  countRule("RAPID_INVESTMENT_ATTEMPTS", "investment", "high", "investment.attempted", "attemptsInTenMinutes", 5),
  amountRule("REPAYMENT_DETERIORATION", "repayment", "medium", "repayment.updated", "missedPayments", 2),
  amountRule("STALE_KYC", "kyc", "medium", "kyc.checked", "ageDays", 365),
  booleanRule("CONFLICTING_CONTRACT_STATE", "contract", "critical", "contract.updated", "stateConflict"),
  countRule("ACCOUNT_LINK_CHURN", "account", "medium", "account.linked", "changesInDay", 3),
]

function booleanRule(code: string, category: string, severity: RiskSeverity, type: string, field: string): RiskRule {
  return rule(code, category, severity, type, (event) => ({
    matched: event.attributes[field] === true,
    explanation: `${field} was reported by the ${type} workflow`,
    evidence: [`event:${event.id}`, `attribute:${field}`],
  }))
}

function amountRule(code: string, category: string, severity: RiskSeverity, type: string, field: string, threshold: number): RiskRule {
  return rule(code, category, severity, type, (event) => {
    const actual = Number(event.attributes[field] ?? 0)
    return {
      matched: Number.isFinite(actual) && actual >= threshold,
      explanation: `${field} ${actual} met the documented threshold ${threshold}`,
      evidence: [`event:${event.id}`, `${field}:${actual}`],
    }
  })
}

function countRule(...args: Parameters<typeof amountRule>): RiskRule {
  return amountRule(...args)
}

function rule(
  code: string,
  category: string,
  severity: RiskSeverity,
  eventType: string,
  evaluate: RiskRule["evaluate"]
): RiskRule {
  return {
    code, version: 1, category, severity, enabled: true,
    eventTypes: [eventType], effectiveFrom: new Date("2026-01-01T00:00:00Z"),
    cooldownMs: 60 * 60 * 1000, evaluate,
  }
}

export function evaluateRiskEvent(
  event: RiskEvent,
  rules: RiskRule[] = INITIAL_RISK_RULES,
  suppressions: Suppression[] = [],
  now = new Date()
): RiskSignal[] {
  return rules.flatMap((currentRule) => {
    if (!currentRule.enabled || !currentRule.eventTypes.includes(event.type)) return []
    if (currentRule.effectiveFrom > event.occurredAt || (currentRule.effectiveUntil && currentRule.effectiveUntil <= event.occurredAt)) return []
    const suppressed = suppressions.some((item) =>
      item.ruleCode === currentRule.code &&
      (!item.subjectId || item.subjectId === event.subjectId) &&
      item.expiresAt > now &&
      item.reason.trim().length > 0
    )
    if (suppressed) return []
    const result = currentRule.evaluate(event)
    if (!result.matched) return []
    return [{
      dedupeKey: `${event.id}:${currentRule.code}:v${currentRule.version}`,
      eventId: event.id,
      subjectId: event.subjectId,
      ruleCode: currentRule.code,
      ruleVersion: currentRule.version,
      category: currentRule.category,
      severity: currentRule.severity,
      explanation: result.explanation,
      evidence: result.evidence,
      eventTime: event.occurredAt,
      evaluatedAt: now,
    }]
  })
}

export function calculateReviewDeadline(severity: RiskSeverity, openedAt: Date): Date {
  const hours = { critical: 1, high: 4, medium: 24, low: 72 }[severity]
  return new Date(openedAt.getTime() + hours * 60 * 60 * 1000)
}

export async function replayRiskEvents(
  events: AsyncIterable<RiskEvent>,
  persist: (signal: RiskSignal) => Promise<"created" | "duplicate">,
  options: { from: Date; to: Date; limit: number; rules?: RiskRule[] }
) {
  if (options.limit < 1 || options.limit > 10_000) throw new Error("replay limit must be between 1 and 10000")
  let scanned = 0
  let created = 0
  for await (const event of events) {
    if (scanned >= options.limit) break
    if (event.occurredAt < options.from || event.occurredAt > options.to) continue
    scanned += 1
    for (const signal of evaluateRiskEvent(event, options.rules)) {
      if (await persist(signal) === "created") created += 1
    }
  }
  return { scanned, created }
}
