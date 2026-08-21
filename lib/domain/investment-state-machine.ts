export type InvestmentStatus = "Funding" | "Active" | "Completed"
export type InvestmentActorType = "admin" | "system"

/**
 * Authoritative transition table for the direct-vehicle Investment lifecycle.
 *
 * Funding is the initial state when an investment is recorded but the
 * underlying loan has not yet been activated. Once the loan activates, all
 * investments for that vehicle move to Active. When the loan completes, they
 * move to Completed. Completed is terminal.
 */
export const INVESTMENT_VALID_TRANSITIONS: Record<InvestmentStatus, InvestmentStatus[]> = {
  Funding: ["Active"],
  Active: ["Completed"],
  Completed: [],
}

export const INVESTMENT_TRANSITION_ACTORS: Record<InvestmentStatus, InvestmentActorType[]> = {
  Funding: [],
  Active: ["admin", "system"],
  Completed: ["admin", "system"],
}

export function isValidInvestmentTransition(
  from: InvestmentStatus | null,
  to: InvestmentStatus,
): boolean {
  if (!from) return true
  if (from === to) return true
  return (INVESTMENT_VALID_TRANSITIONS[from] || []).includes(to)
}

export function isInvestmentActorAllowed(
  targetState: InvestmentStatus,
  actorType: InvestmentActorType,
): boolean {
  return (INVESTMENT_TRANSITION_ACTORS[targetState] || []).includes(actorType)
}

export function isTerminalInvestmentState(state: InvestmentStatus): boolean {
  return state === "Completed"
}
