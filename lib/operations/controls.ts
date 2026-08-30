export const FINANCIAL_OPERATIONS = [
  "wallet.fund", "wallet.debit", "investment.create", "down-payment.create",
  "repayment.create", "payout.create", "kyc.upload", "account.link", "admin.adjust",
] as const
export type FinancialOperation = typeof FINANCIAL_OPERATIONS[number]
export type ControlState = "enabled" | "degraded" | "paused" | "read-only"

export interface OperationalControl {
  id: string
  version: number
  operation: FinancialOperation | "*"
  provider?: string
  state: ControlState
  reason: string
  incidentId: string
  actorId: string
  approvedBy?: string
  startsAt: Date
  expiresAt?: Date
}

export interface ControlDecision {
  allowed: boolean
  state: ControlState
  code?: "OPERATION_PAUSED" | "READ_ONLY" | "CONTROL_UNAVAILABLE"
  message?: string
  controlId?: string
}

export function evaluateOperationalControl(
  operation: FinancialOperation,
  controls: OperationalControl[] | null,
  options: { provider?: string; now?: Date; idempotentCompletion?: boolean } = {}
): ControlDecision {
  if (controls === null) {
    return { allowed: false, state: "paused", code: "CONTROL_UNAVAILABLE", message: "This operation is temporarily unavailable." }
  }
  const now = options.now ?? new Date()
  const active = controls
    .filter((control) =>
      (control.operation === operation || control.operation === "*") &&
      (!control.provider || control.provider === options.provider) &&
      control.startsAt <= now &&
      (!control.expiresAt || control.expiresAt > now)
    )
    .sort((a, b) => impact(b.state) - impact(a.state) || b.version - a.version)[0]

  if (!active || active.state === "enabled" || active.state === "degraded") {
    return { allowed: true, state: active?.state ?? "enabled", controlId: active?.id }
  }
  if (options.idempotentCompletion) {
    return { allowed: true, state: active.state, controlId: active.id }
  }
  return {
    allowed: false,
    state: active.state,
    code: active.state === "read-only" ? "READ_ONLY" : "OPERATION_PAUSED",
    message: "This financial operation is temporarily unavailable. Your existing records remain available.",
    controlId: active.id,
  }
}

function impact(state: ControlState) {
  return { enabled: 0, degraded: 1, "read-only": 2, paused: 3 }[state]
}

export class ProviderCircuitBreaker {
  private state: "closed" | "open" | "half-open" = "closed"
  private failures: number[] = []
  private openedAt?: number
  constructor(
    private readonly options = { failureThreshold: 5, windowMs: 60_000, recoveryMs: 30_000 }
  ) {}

  canRequest(now = Date.now()) {
    if (this.state === "open" && this.openedAt !== undefined && now - this.openedAt >= this.options.recoveryMs) {
      this.state = "half-open"
    }
    return this.state !== "open"
  }

  recordSuccess() {
    this.failures = []
    this.openedAt = undefined
    this.state = "closed"
  }

  recordFailure(now = Date.now()) {
    this.failures = this.failures.filter((time) => now - time <= this.options.windowMs)
    this.failures.push(now)
    if (this.state === "half-open" || this.failures.length >= this.options.failureThreshold) {
      this.state = "open"
      this.openedAt = now
    }
  }

  snapshot() {
    return { state: this.state, failuresInWindow: this.failures.length, openedAt: this.openedAt }
  }
}

export function validateControlChange(control: OperationalControl) {
  if (!control.reason.trim() || !control.incidentId.trim()) throw new Error("reason and incident ID are required")
  if (control.operation === "*" && control.state !== "enabled" && !control.approvedBy) {
    throw new Error("global controls require maker-checker approval")
  }
  if (control.approvedBy && control.approvedBy === control.actorId) {
    throw new Error("approver must differ from the control author")
  }
}
