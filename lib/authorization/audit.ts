import { logAuditEvent } from "@/lib/security/audit-log"
import type { AuthorizationAction, AuthorizationDecision, ResourceType } from "./policy"

export async function logAuthorizationDenial(input: { actor: any; action: AuthorizationAction; resourceType: ResourceType; decision: Extract<AuthorizationDecision, { allowed: false }> }) {
  await logAuditEvent({ actor: input.actor, action: "authorization.denied", targetType: input.resourceType, status: "failure", metadata: { requestedAction: input.action, reason: input.decision.reason } })
}
