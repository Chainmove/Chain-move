import type { AppUserRole } from "@/lib/api/route-guard"
import { isRepayableState } from "@/lib/contracts/state-machine"

export const AUTHORIZATION_ACTIONS = [
  "account:read", "account:update", "activity:read", "activity:update",
  "investment:read", "investment:create", "loan:read", "loan:create", "loan:approve",
  "contract:read", "repayment:read", "repayment:record", "kyc:document:read", "kyc:review",
  "wallet:read", "wallet:adjust", "notification:read", "notification:create",
  "admin:report", "admin:user:manage", "admin:settings:manage", "admin:issue:manage",
  "vehicle:read", "vehicle:manage", "pool:read", "pool:manage", "email:send", "file:upload",
] as const

export type AuthorizationAction = (typeof AUTHORIZATION_ACTIONS)[number]
export type ResourceType = "account" | "activity" | "investment" | "loan" | "contract" | "repayment" | "kyc" | "wallet" | "notification" | "report" | "user" | "settings" | "issue" | "vehicle" | "pool" | "email" | "file"

export interface AuthorizationContext {
  principal: { id: string; role: AppUserRole | null; kycApproved?: boolean; privileged?: boolean }
}

export interface AuthorizationResource {
  type: ResourceType
  ownerId?: string | null
  state?: string | null
  exists?: boolean
}

export type AuthorizationDecision = { allowed: true } | { allowed: false; reason: "invalid_role" | "role_denied" | "not_owner" | "kyc_required" | "invalid_state" | "privileged_operation_required" | "resource_unavailable"; conceal: boolean }

export function authorizeRole(role: AppUserRole | null, allowedRoles?: readonly AppUserRole[]): AuthorizationDecision {
  if (!role) return { allowed: false, reason: "invalid_role", conceal: false }
  if (allowedRoles && !allowedRoles.includes(role)) return { allowed: false, reason: "role_denied", conceal: false }
  return { allowed: true }
}

const adminOnly = new Set<AuthorizationAction>(["loan:approve", "kyc:review", "wallet:adjust", "notification:create", "admin:report", "admin:user:manage", "admin:settings:manage", "admin:issue:manage", "vehicle:manage", "email:send"])
const ownerActions = new Set<AuthorizationAction>(["account:read", "account:update", "activity:read", "activity:update", "investment:read", "loan:read", "contract:read", "repayment:read", "repayment:record", "kyc:document:read", "wallet:read", "notification:read"])

export function authorize(context: AuthorizationContext, action: AuthorizationAction, resource: AuthorizationResource): AuthorizationDecision {
  const { principal } = context
  const roleDecision = authorizeRole(principal.role)
  if (!roleDecision.allowed) return roleDecision
  if (resource.exists === false) return { allowed: false, reason: "resource_unavailable", conceal: true }

  if (adminOnly.has(action)) {
    if (principal.role !== "admin") return { allowed: false, reason: "role_denied", conceal: false }
    if ((action === "wallet:adjust" || action === "admin:user:manage") && !principal.privileged) return { allowed: false, reason: "privileged_operation_required", conceal: false }
    if (action === "loan:approve" && !["Pending", "Under Review"].includes(resource.state || "")) return { allowed: false, reason: "invalid_state", conceal: false }
    return { allowed: true }
  }

  if (action === "loan:create" || action === "investment:create") {
    const role = action === "loan:create" ? "driver" : "investor"
    if (principal.role !== role) return { allowed: false, reason: "role_denied", conceal: false }
    if (!principal.kycApproved) return { allowed: false, reason: "kyc_required", conceal: false }
    return { allowed: true }
  }

  if (action === "pool:manage" && principal.role !== "admin" && principal.role !== "investor") return { allowed: false, reason: "role_denied", conceal: false }
  if (action === "file:upload" && principal.role === "admin") return { allowed: false, reason: "role_denied", conceal: false }
  if (principal.role === "admin") return { allowed: true }
  if (action.startsWith("investment:") && principal.role !== "investor") return { allowed: false, reason: "role_denied", conceal: false }
  if ((action.startsWith("loan:") || action.startsWith("contract:") || action.startsWith("repayment:")) && principal.role !== "driver") return { allowed: false, reason: "role_denied", conceal: false }
  if (ownerActions.has(action) && resource.ownerId !== principal.id) return { allowed: false, reason: "not_owner", conceal: true }
  if (action === "repayment:record" && !isRepayableState(resource.state)) return { allowed: false, reason: "invalid_state", conceal: false }
  if (action === "vehicle:manage" || action.startsWith("admin:") || action === "kyc:review" || action === "email:send") return { allowed: false, reason: "role_denied", conceal: false }
  return { allowed: true }
}

export function isKycApproved(user: unknown) {
  if (!user || typeof user !== "object") return false
  const candidate = user as { kycStatus?: unknown; isKycVerified?: unknown; kycVerified?: unknown }
  return candidate.kycStatus === "approved_stage2" || candidate.isKycVerified === true || candidate.kycVerified === true
}
