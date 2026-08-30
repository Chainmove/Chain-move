"use client"

import Link from "next/link"

import { Button } from "@/components/ui/button"
import { getDashboardRoleConfig, type DashboardQuickAction, type DashboardRole } from "@/lib/dashboard/roles"
import { cn } from "@/lib/utils"

interface DashboardQuickActionsProps {
  role: DashboardRole
  /** Optional override; defaults to the role's configured quick actions. */
  actions?: DashboardQuickAction[]
  /** Limit the number of actions rendered (useful in compact headers). */
  max?: number
  className?: string
}

/**
 * Renders the per-role quick action slots configured in {@link getDashboardRoleConfig}.
 * Used in dashboard headers so each role surfaces its most common task without
 * the header needing to hard-code role-specific buttons.
 */
export function DashboardQuickActions({ role, actions, max, className }: DashboardQuickActionsProps) {
  const resolvedActions = actions ?? getDashboardRoleConfig(role)?.quickActions ?? []
  const visibleActions = typeof max === "number" ? resolvedActions.slice(0, max) : resolvedActions

  if (visibleActions.length === 0) return null

  return (
    <div className={cn("flex items-center gap-2", className)}>
      {visibleActions.map((action) => (
        <Button
          key={action.href}
          asChild
          size="sm"
          variant={action.primary ? "default" : "outline"}
          className="h-9"
        >
          <Link href={action.href}>
            <action.icon className="mr-2 h-4 w-4" />
            <span className="truncate">{action.label}</span>
          </Link>
        </Button>
      ))}
    </div>
  )
}
