export type LoanStatus =
  | "Pending"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "Active"
  | "Completed"
  | "Cancelled"

export type LoanActorType = "driver" | "admin" | "system"

/**
 * Authoritative transition table for the loan lifecycle.
 *
 * Rejected, Completed, and Cancelled are terminal — once reached, no further
 * ordinary transitions are permitted. An admin override path is intentionally
 * omitted here; administrative corrections must use a separate, audited command.
 */
export const LOAN_VALID_TRANSITIONS: Record<LoanStatus, LoanStatus[]> = {
  Pending: ["Under Review", "Rejected", "Cancelled"],
  "Under Review": ["Approved", "Rejected", "Cancelled"],
  Approved: ["Active", "Rejected", "Cancelled"],
  Active: ["Completed"],
  Rejected: [],
  Completed: [],
  Cancelled: [],
}

// Which actor types may drive a transition INTO a given target status.
export const LOAN_TRANSITION_ACTORS: Record<LoanStatus, LoanActorType[]> = {
  Pending: [],
  "Under Review": ["admin"],
  Approved: ["admin"],
  Rejected: ["admin"],
  Active: ["admin", "system"],
  Completed: ["admin", "system"],
  Cancelled: ["admin", "driver"],
}

export const TERMINAL_LOAN_STATES: LoanStatus[] = ["Rejected", "Completed", "Cancelled"]

export const PRE_ACTIVE_LOAN_STATES: LoanStatus[] = ["Pending", "Under Review", "Approved"]

export function isValidLoanTransition(
  from: LoanStatus | null,
  to: LoanStatus,
): boolean {
  if (!from) return true
  if (from === to) return true
  return (LOAN_VALID_TRANSITIONS[from] || []).includes(to)
}

export function isLoanActorAllowed(
  targetState: LoanStatus,
  fromState: LoanStatus | null,
  actorType: LoanActorType,
): boolean {
  const allowed = LOAN_TRANSITION_ACTORS[targetState] || []
  if (!allowed.includes(actorType)) return false
  // Drivers may only cancel before the loan becomes active.
  if (targetState === "Cancelled" && actorType === "driver") {
    return fromState !== null && PRE_ACTIVE_LOAN_STATES.includes(fromState)
  }
  return true
}

export function isTerminalLoanState(state: LoanStatus): boolean {
  return TERMINAL_LOAN_STATES.includes(state)
}

export function isRepayableLoanState(state: LoanStatus | string | null | undefined): boolean {
  return state === "Active"
}
