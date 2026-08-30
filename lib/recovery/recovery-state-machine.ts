/**
 * Wallet recovery state machine.
 *
 * Valid transitions:
 *   requested   → challenged  (user submits initial factors)
 *   challenged  → cooling_off (all required factors verified; delay begins)
 *   cooling_off → approved    (admin completes high-risk review)
 *   approved    → executed    (cooling-off elapsed + all factors satisfied)
 *   any active  → cancelled   (old-wallet proof or user-initiated cancel)
 *   any active  → disputed    (third-party dispute during cooling-off or approved)
 *
 * Terminal states: executed, cancelled, disputed
 */

import type { RecoveryState } from "@/models/WalletRecovery"

type ActiveState = "requested" | "challenged" | "cooling_off" | "approved"
type TerminalState = "executed" | "cancelled" | "disputed"

export const TERMINAL_STATES: ReadonlySet<RecoveryState> = new Set<RecoveryState>([
  "executed",
  "cancelled",
  "disputed",
])

const ALLOWED_TRANSITIONS: Record<RecoveryState, ReadonlyArray<RecoveryState>> = {
  requested: ["challenged", "cancelled"],
  challenged: ["cooling_off", "cancelled"],
  cooling_off: ["approved", "cancelled", "disputed"],
  approved: ["executed", "cancelled", "disputed"],
  executed: [],
  cancelled: [],
  disputed: [],
}

export class RecoveryTransitionError extends Error {
  constructor(from: RecoveryState, to: RecoveryState) {
    super(`Invalid recovery transition: ${from} → ${to}`)
    this.name = "RecoveryTransitionError"
  }
}

export function assertTransition(from: RecoveryState, to: RecoveryState): void {
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new RecoveryTransitionError(from, to)
  }
}

export function canTransition(from: RecoveryState, to: RecoveryState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to)
}

export function isTerminal(state: RecoveryState): boolean {
  return TERMINAL_STATES.has(state)
}

export function isActive(state: RecoveryState): boolean {
  return !isTerminal(state)
}

/** Cooling-off period before execution (72 hours). */
export const COOLING_OFF_DURATION_MS = 72 * 60 * 60 * 1_000

/** Recovery request expiry (14 days from creation). */
export const RECOVERY_EXPIRY_MS = 14 * 24 * 60 * 60 * 1_000

export function coolingOffEndsAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + COOLING_OFF_DURATION_MS)
}

export function recoveryExpiresAt(from: Date = new Date()): Date {
  return new Date(from.getTime() + RECOVERY_EXPIRY_MS)
}

export function isCoolingOffComplete(coolingOffEndsAt: Date): boolean {
  return new Date() >= coolingOffEndsAt
}
