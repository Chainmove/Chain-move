import { CanonicalSettlementState } from "@/models/SettlementRecord"

export const VALID_TRANSITIONS: Record<CanonicalSettlementState, CanonicalSettlementState[]> = {
  initiated: ["provider-pending", "observed", "provisionally_credited", "confirmed", "failed", "expired"],
  "provider-pending": ["observed", "provisionally_credited", "confirmed", "failed", "expired"],
  observed: ["provisionally_credited", "confirmed", "failed", "expired"],
  provisionally_credited: ["confirmed", "reversed", "failed"],
  confirmed: ["reversed", "disputed"],
  disputed: ["confirmed", "reversed"],
  reversed: [],
  failed: [],
  expired: [],
}

export function isValidTransition(
  fromState: CanonicalSettlementState | null,
  toState: CanonicalSettlementState,
): boolean {
  if (!fromState) return true
  if (fromState === toState) return true
  const allowed = VALID_TRANSITIONS[fromState] || []
  return allowed.includes(toState)
}

export function determineSafeActions(state: CanonicalSettlementState, isStuck = false): string[] {
  switch (state) {
    case "initiated":
    case "provider-pending":
      return isStuck ? ["RETRY_VERIFICATION", "MARK_EXPIRED", "FORCE_CONFIRM"] : ["RETRY_VERIFICATION"]
    case "observed":
    case "provisionally_credited":
      return isStuck ? ["RETRY_VERIFICATION", "FORCE_CONFIRM", "POST_REVERSAL"] : ["RETRY_VERIFICATION"]
    case "confirmed":
      return ["POST_REVERSAL", "FLAG_DISPUTE"]
    case "disputed":
      return ["RESOLVE_DISPUTE_CONFIRM", "RESOLVE_DISPUTE_REVERSE"]
    case "failed":
    case "expired":
      return ["REINITIALIZE_SETTLEMENT"]
    case "reversed":
      return []
    default:
      return []
  }
}
