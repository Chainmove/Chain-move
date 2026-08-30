import type { ComponentType } from "react"
import { Compass, FileText, PlusCircle, Receipt, ShieldCheck, Wallet } from "lucide-react"

type DashboardIcon = ComponentType<{ className?: string }>

/**
 * Central source of truth for the role-aware dashboard shell.
 *
 * Sidebar navigation, header role badges, quick actions and route guards all
 * derive their behaviour from this module so new dashboard modules can be added
 * for a role without duplicating layout or authorization logic.
 */
export type DashboardRole = "driver" | "investor" | "admin"

export const DASHBOARD_ROLES: DashboardRole[] = ["driver", "investor", "admin"]

export interface DashboardQuickAction {
  label: string
  href: string
  icon: DashboardIcon
  /** Highlights the primary call to action for the role. */
  primary?: boolean
}

export interface DashboardRoleConfig {
  role: DashboardRole
  /** Short label used in badges and headings. */
  label: string
  /** Landing route a member of this role is sent to. */
  homePath: string
  /** Quick action slots rendered in the dashboard header for the role. */
  quickActions: DashboardQuickAction[]
}

export const DASHBOARD_ROLE_CONFIG: Record<DashboardRole, DashboardRoleConfig> = {
  investor: {
    role: "investor",
    label: "Investor",
    homePath: "/dashboard/investor",
    quickActions: [
      { label: "Fund Wallet", href: "/dashboard/investor/wallet", icon: PlusCircle, primary: true },
      { label: "Explore Opportunities", href: "/dashboard/investor/opportunities", icon: Compass },
    ],
  },
  driver: {
    role: "driver",
    label: "Driver",
    homePath: "/dashboard/driver",
    quickActions: [
      { label: "Make Payment", href: "/dashboard/driver/repayment", icon: Wallet, primary: true },
      { label: "Payment History", href: "/dashboard/driver/payments", icon: Receipt },
    ],
  },
  admin: {
    role: "admin",
    label: "Admin",
    homePath: "/dashboard/admin",
    quickActions: [
      { label: "Review KYC", href: "/dashboard/admin/kyc-management", icon: ShieldCheck, primary: true },
      { label: "Reports", href: "/dashboard/admin/reports", icon: FileText },
    ],
  },
}

/** Type guard that narrows an arbitrary value to a known {@link DashboardRole}. */
export function isDashboardRole(value: unknown): value is DashboardRole {
  return typeof value === "string" && (DASHBOARD_ROLES as string[]).includes(value)
}

/** Returns the config for a role, or `null` when the value is not a dashboard role. */
export function getDashboardRoleConfig(value: unknown): DashboardRoleConfig | null {
  return isDashboardRole(value) ? DASHBOARD_ROLE_CONFIG[value] : null
}

/** Normalizes the list of roles allowed to view a section into an array. */
export function resolveAllowedRoles(allow: DashboardRole | DashboardRole[]): DashboardRole[] {
  return Array.isArray(allow) ? allow : [allow]
}

/** Resolves the home path for a role, falling back to the generic dashboard root. */
export function getDashboardHomePath(value: unknown): string {
  return getDashboardRoleConfig(value)?.homePath ?? "/dashboard"
}
