import { NextResponse } from "next/server"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"

export const APP_USER_ROLES = ["admin", "driver", "investor"] as const

export type AppUserRole = (typeof APP_USER_ROLES)[number]
export type AuthenticatedRequestContext = Awaited<ReturnType<typeof getAuthenticatedUser>>

export function normalizeUserRole(role: unknown): AppUserRole | null {
  if (role === "admin" || role === "driver" || role === "investor") {
    return role
  }

  return null
}

export async function requireAuthenticatedUser(
  request: Request,
  allowedRoles?: readonly AppUserRole[],
  options?: {
    unauthorizedMessage?: string
    forbiddenMessage?: string
  },
) {
  const authContext = await getAuthenticatedUser(request)
  if (!authContext.user) {
    return {
      response: NextResponse.json(
        { message: options?.unauthorizedMessage || "Unauthorized" },
        { status: 401 },
      ),
    }
  }

  const role = normalizeUserRole(authContext.user.role)
  if (allowedRoles && (!role || !allowedRoles.includes(role))) {
    return {
      response: NextResponse.json(
        { message: options?.forbiddenMessage || "Access denied" },
        { status: 403 },
      ),
    }
  }

  // `authContext.user` is guaranteed non-null past the guard above; re-assert it
  // so callers don't have to null-check the authenticated user.
  return { ...authContext, user: authContext.user }
}

export async function finalizeAuthenticatedResponse(
  response: NextResponse,
  authContext: AuthenticatedRequestContext,
) {
  return authContext.user && authContext.shouldRefreshSession
    ? withSessionRefresh(response, authContext.user)
    : response
}
