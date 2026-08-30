import type { AuthorizationAction, AuthorizationDecision, ResourceType } from "./policy"

export function denialAuditMetadata(action: AuthorizationAction, resourceType: ResourceType, decision: Extract<AuthorizationDecision, { allowed: false }>) {
  return { requestedAction: action, resourceType, reason: decision.reason }
}
