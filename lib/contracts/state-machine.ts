import { HirePurchaseContractStatus, HirePurchaseContractTransitionActor } from "@/models/HirePurchaseContract"

/**
 * Authoritative transition table for the hire-purchase contract lifecycle.
 *
 * REPOSSESSED, CANCELLED and COMPLETED only ever flow forward into CLOSED — a
 * repossessed or cancelled contract is never "completed", and a cancelled
 * contract is always pre-activation (see CANCELLATION_ACTORS below), so it
 * never re-enters the active branch of the lifecycle.
 *
 * COMPLETED -> ACTIVE is intentionally allowed: it is the reconciliation path
 * used by lib/integrity/repairEngine.ts to reopen a contract that was marked
 * COMPLETED while a payable balance still remained (a legacy data-integrity
 * bug this state machine otherwise prevents by construction). It is restricted
 * to admin/system actors via TRANSITION_ACTORS below, exactly like any other
 * transition into ACTIVE.
 */
export const VALID_TRANSITIONS: Record<HirePurchaseContractStatus, HirePurchaseContractStatus[]> = {
  PENDING_APPROVAL: ["APPROVED", "CANCELLED"],
  APPROVED: ["VEHICLE_ASSIGNED", "CANCELLED"],
  VEHICLE_ASSIGNED: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["DELINQUENT", "RESTRUCTURED", "COMPLETED"],
  DELINQUENT: ["ACTIVE", "RESTRUCTURED", "REPOSSESSED", "COMPLETED"],
  RESTRUCTURED: ["ACTIVE", "DELINQUENT", "REPOSSESSED", "COMPLETED"],
  COMPLETED: ["ACTIVE", "CLOSED"],
  REPOSSESSED: ["CLOSED"],
  CANCELLED: ["CLOSED"],
  CLOSED: [],
}

// Statuses reached before a vehicle has been handed over and repayments begin.
const PRE_ACTIVATION_STATES: HirePurchaseContractStatus[] = ["PENDING_APPROVAL", "APPROVED", "VEHICLE_ASSIGNED"]

// Statuses in which the driver still owes money and repayments may be recorded.
const REPAYABLE_STATES: HirePurchaseContractStatus[] = ["ACTIVE", "DELINQUENT", "RESTRUCTURED"]

// Which actor types may drive a transition INTO a given target status.
const TRANSITION_ACTORS: Record<HirePurchaseContractStatus, HirePurchaseContractTransitionActor[]> = {
  PENDING_APPROVAL: [],
  APPROVED: ["admin"],
  VEHICLE_ASSIGNED: ["admin"],
  ACTIVE: ["admin", "system"],
  DELINQUENT: ["admin", "system"],
  RESTRUCTURED: ["admin"],
  COMPLETED: ["admin", "system"],
  REPOSSESSED: ["admin"],
  CANCELLED: ["admin", "driver"],
  CLOSED: ["admin", "system"],
}

export function isValidTransition(
  fromState: HirePurchaseContractStatus | null,
  toState: HirePurchaseContractStatus,
): boolean {
  if (!fromState) return true
  if (fromState === toState) return true
  return (VALID_TRANSITIONS[fromState] || []).includes(toState)
}

export function isPreActivationState(state: HirePurchaseContractStatus): boolean {
  return PRE_ACTIVATION_STATES.includes(state)
}

export function isRepayableState(state: string | null | undefined): boolean {
  return REPAYABLE_STATES.includes(state as HirePurchaseContractStatus)
}

/**
 * A driver may only cancel their own contract before it has been activated
 * (no vehicle handed over, no repayment obligations yet). Admins may cancel
 * from any non-terminal, pre-activation state as well; neither actor may
 * cancel an ACTIVE/DELINQUENT/RESTRUCTURED contract — that path is
 * REPOSSESSED (admin-only) or COMPLETED (full settlement).
 */
export function isActorAllowedForTransition(
  targetState: HirePurchaseContractStatus,
  fromState: HirePurchaseContractStatus | null,
  actorType: HirePurchaseContractTransitionActor,
): boolean {
  const allowedActors = TRANSITION_ACTORS[targetState] || []
  if (!allowedActors.includes(actorType)) return false
  if (targetState === "CANCELLED" && actorType === "driver") {
    return fromState !== null && isPreActivationState(fromState)
  }
  return true
}
