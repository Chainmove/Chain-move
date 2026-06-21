"use client"

import Link from "next/link"
import { ShieldAlert } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { getDashboardRoleConfig, type DashboardRole } from "@/lib/dashboard/roles"
import { cn } from "@/lib/utils"

interface DashboardUnauthorizedProps {
  /** The roles that are allowed to view the section the user tried to reach. */
  requiredRoles?: DashboardRole[]
  /** The role the current user actually has, used to offer a way back home. */
  currentRole?: string
  title?: string
  description?: string
  className?: string
}

function describeRequiredRoles(requiredRoles?: DashboardRole[]) {
  if (!requiredRoles || requiredRoles.length === 0) return "the right"
  const labels = requiredRoles.map((role) => getDashboardRoleConfig(role)?.label ?? role)
  if (labels.length === 1) return `an ${labels[0]}`
  return labels.join(" or ")
}

/**
 * Graceful "access denied" state shared across every protected dashboard
 * section so unauthorized users get a consistent, recoverable experience.
 */
export function DashboardUnauthorized({
  requiredRoles,
  currentRole,
  title = "Access denied",
  description,
  className,
}: DashboardUnauthorizedProps) {
  const homeConfig = getDashboardRoleConfig(currentRole)
  const resolvedDescription =
    description ?? `You need ${describeRequiredRoles(requiredRoles)} account to access this section.`

  return (
    <div className={cn("flex min-h-screen items-center justify-center bg-background p-4", className)}>
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-3">
          <span className="inline-flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
            <ShieldAlert className="h-5 w-5" />
          </span>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{resolvedDescription}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-2 sm:flex-row">
          {homeConfig ? (
            <Button asChild className="w-full">
              <Link href={homeConfig.homePath}>Go to my dashboard</Link>
            </Button>
          ) : null}
          <Button asChild variant={homeConfig ? "outline" : "default"} className="w-full">
            <Link href="/signin">Sign in with another account</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
