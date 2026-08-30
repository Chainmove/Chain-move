import { z } from "zod"
import { getAuthenticatedUser } from "@/lib/auth/current-user"
import { normalizeUserRole } from "@/lib/api/route-guard"
import { parseJsonBody } from "@/lib/api/validation"
import { authorize, isKycApproved, type AuthorizationAction, type AuthorizationResource } from "./policy"
import { logAuthorizationDenial } from "./audit"
import { authenticationRequiredResponse, authorizationDeniedResponse } from "./responses"

export async function authorizeRequest(request: Request, action: AuthorizationAction, resource: AuthorizationResource | ((user: any) => Promise<AuthorizationResource>)) {
  const auth = await getAuthenticatedUser(request)
  if (!auth.user) return { response: authenticationRequiredResponse() }
  const resolved = typeof resource === "function" ? await resource(auth.user) : resource
  const decision = authorize({ principal: { id: auth.user._id.toString(), role: normalizeUserRole(auth.user.role), kycApproved: isKycApproved(auth.user.toObject()), privileged: auth.user.role === "admin" } }, action, resolved)
  if (!decision.allowed) {
    await logAuthorizationDenial({ actor: auth.user, action, resourceType: resolved.type, decision })
    return { response: authorizationDeniedResponse(decision) }
  }
  return { ...auth, user: auth.user, resource: resolved }
}

export async function authorizeJsonRequest<T extends z.ZodTypeAny>(request: Request, schema: T, action: AuthorizationAction, loadResource: (data: z.infer<T>, user: any) => Promise<AuthorizationResource>) {
  const parsed = await parseJsonBody(request, schema)
  if ("response" in parsed) return parsed
  const authorized = await authorizeRequest(request, action, user => loadResource(parsed.data, user))
  return "response" in authorized ? authorized : { ...authorized, data: parsed.data }
}
