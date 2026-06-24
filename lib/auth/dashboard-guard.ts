import { redirect } from "next/navigation"

import { getSessionFromCookies, type SessionPayload } from "@/lib/auth/session"
import { getDashboardHomePath, isDashboardRole, type DashboardRole } from "@/lib/dashboard/roles"

/**
 * Server-side counterpart to the `DashboardGuard` client component.
 *
 * Use in server components / route handlers to require an authenticated session
 * (and, optionally, a specific role) before rendering a protected dashboard
 * section. Unauthenticated visitors are redirected to sign in; authenticated
 * users with the wrong role are sent to their own dashboard home.
 */
export async function requireDashboardSession(
  allow?: DashboardRole | DashboardRole[],
): Promise<SessionPayload> {
  const session = await getSessionFromCookies()
  if (!session?.userId) {
    redirect("/signin")
  }

  if (allow) {
    const allowedRoles = Array.isArray(allow) ? allow : [allow]
    if (!isDashboardRole(session.role) || !allowedRoles.includes(session.role)) {
      redirect(getDashboardHomePath(session.role))
    }
  }

  return session
}
