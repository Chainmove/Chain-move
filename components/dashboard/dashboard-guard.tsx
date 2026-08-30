"use client"

import { useEffect, type ReactNode } from "react"
import { useRouter } from "next/navigation"

import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"
import { DashboardUnauthorized } from "@/components/dashboard/dashboard-unauthorized"
import { useAuth } from "@/hooks/use-auth"
import { resolveAllowedRoles, type DashboardRole } from "@/lib/dashboard/roles"

interface DashboardGuardProps {
  /** Role or roles permitted to view the guarded section. */
  allow: DashboardRole | DashboardRole[]
  children: ReactNode
  /** Where to send unauthenticated visitors. Defaults to the sign-in page. */
  redirectTo?: string
  loadingTitle?: string
  loadingDescription?: string
}

/**
 * Client-side route guard for role-protected dashboard sections.
 *
 * Edge middleware (`proxy.ts`) already enforces authentication for `/dashboard`,
 * so this guard focuses on role authorization plus graceful loading and
 * unauthorized states. Unauthenticated visitors are redirected to sign in;
 * authenticated users with the wrong role get a recoverable access-denied view.
 */
export function DashboardGuard({
  allow,
  children,
  redirectTo = "/signin",
  loadingTitle = "Loading dashboard",
  loadingDescription = "Please wait while we verify your access.",
}: DashboardGuardProps) {
  const { user, loading } = useAuth()
  const router = useRouter()

  const allowedRoles = resolveAllowedRoles(allow)
  const isAuthorized = Boolean(user?.role && allowedRoles.includes(user.role as DashboardRole))

  useEffect(() => {
    if (!loading && !user) {
      router.replace(redirectTo)
    }
  }, [loading, user, router, redirectTo])

  if (loading || !user) {
    return <DashboardRouteLoading title={loadingTitle} description={loadingDescription} />
  }

  if (!isAuthorized) {
    return <DashboardUnauthorized requiredRoles={allowedRoles} currentRole={user.role} />
  }

  return <>{children}</>
}
