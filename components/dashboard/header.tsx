"use client"

import Link from "next/link"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { emitDashboardSidebarToggle } from "@/components/dashboard/sidebar-events"
import { DashboardQuickActions } from "@/components/dashboard/dashboard-quick-actions"
import { isDashboardRole, type DashboardRole } from "@/lib/dashboard/roles"
import { ThemeToggle } from "@/components/theme-toggle"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Bell, ChevronLeft, Menu, MoreVertical, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { getUserDisplayName, useAuth } from "@/hooks/use-auth"
import { resolveDashboardUserStatus } from "@/lib/users/user-profile"
import { usePathname, useRouter } from "next/navigation"
import { useTheme } from "next-themes"
import dynamic from "next/dynamic"

const WalletMenu = dynamic(
  () => import("./wallet-menu").then((mod) => mod.WalletMenu),
  { ssr: false },
)

interface HeaderProps {
  userName?: string
  userStatus?: string
  notificationCount?: number
  showBackButton?: boolean
  className?: string
}

const STATUS_VARIANTS = new Set(["verified", "verified investor", "verified driver", "system administrator"])
const GENERIC_STATUS_LABELS = new Set(["active", "investor", "driver", "verified investor", "verified driver"])

function inferRoleLabel(pathname: string, userStatus: string, role?: string) {
  if (role === "investor") return "Investor"
  if (role === "driver") return "Driver"
  if (role === "admin") return "Admin"

  const normalizedStatus = userStatus.toLowerCase()
  if (normalizedStatus.includes("investor")) return "Investor"
  if (normalizedStatus.includes("driver")) return "Driver"
  if (normalizedStatus.includes("admin")) return "Admin"

  if (pathname.includes("/dashboard/investor")) return "Investor"
  if (pathname.includes("/dashboard/driver")) return "Driver"
  if (pathname.includes("/dashboard/admin")) return "Admin"

  return "User"
}

function resolveDashboardRole(pathname: string, role?: string): DashboardRole | null {
  if (isDashboardRole(role)) return role
  if (pathname.includes("/dashboard/investor")) return "investor"
  if (pathname.includes("/dashboard/driver")) return "driver"
  if (pathname.includes("/dashboard/admin")) return "admin"
  return null
}

export function Header({
  userStatus = "Active",
  notificationCount = 0,
  showBackButton = false,
  className,
}: HeaderProps) {
  const { user: authUser } = useAuth()
  const { theme, setTheme } = useTheme()
  const pathname = usePathname()
  const router = useRouter()

  const roleLabel = inferRoleLabel(pathname, userStatus, authUser?.role)
  const resolvedUserName = getUserDisplayName(authUser, roleLabel)
  const normalizedRequestedStatus = userStatus.toLowerCase()
  const effectiveUserStatus =
    authUser && GENERIC_STATUS_LABELS.has(normalizedRequestedStatus)
      ? resolveDashboardUserStatus(authUser)
      : userStatus

  const normalizedStatus = effectiveUserStatus.toLowerCase()
  const isVerified = STATUS_VARIANTS.has(normalizedStatus)
  const dashboardRole = resolveDashboardRole(pathname, authUser?.role)
  const toggleTheme = () => setTheme(theme === "light" ? "dark" : "light")

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b border-border/40 bg-background/90 px-4 py-3 backdrop-blur md:px-6",
        className,
      )}
    >
      <div className="flex min-h-12 items-center justify-between gap-2 sm:gap-3">
        <div className="flex min-w-0 items-center gap-2 sm:gap-4">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 md:hidden"
            onClick={emitDashboardSidebarToggle}
            aria-label="Open sidebar menu"
          >
            <Menu className="h-4 w-4" />
          </Button>

          {showBackButton ? (
            <Button
              variant="outline"
              size="icon"
              onClick={() => router.back()}
              className="h-9 w-9"
              aria-label="Go back"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
          ) : null}

          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold text-foreground md:text-lg">Dashboard</h2>
            <p className="hidden truncate text-xs text-muted-foreground sm:block">Welcome back, {resolvedUserName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 sm:gap-3">
          {dashboardRole ? (
            <DashboardQuickActions role={dashboardRole} max={1} className="hidden lg:flex" />
          ) : null}

          <div className="hidden md:block">
            <Badge
              variant={isVerified ? "default" : "secondary"}
              className={cn(
                "text-xs font-medium",
                isVerified ? "bg-green-600 text-white hover:bg-green-600" : "bg-yellow-600 text-white hover:bg-yellow-600",
              )}
            >
              {effectiveUserStatus}
            </Badge>
          </div>

          <ThemeToggle className="hidden md:inline-flex" />

          <Button
            variant="ghost"
            size="icon"
            className="relative h-9 w-9 rounded-full text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label="Notifications"
          >
            <Bell className="h-[1.2rem] w-[1.2rem]" />
            {notificationCount > 0 ? (
              <span className="absolute -right-1 -top-1 inline-flex min-w-5 items-center justify-center rounded-full bg-red-500 px-1.5 text-[10px] font-semibold text-white">
                {notificationCount > 99 ? "99+" : notificationCount}
              </span>
            ) : null}
          </Button>

          <div className="flex items-center gap-2">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-primary/10 text-primary">
              <User className="h-4 w-4" />
            </div>
            <div className="hidden min-w-0 lg:block">
              <p className="max-w-[140px] truncate text-sm font-medium text-foreground">{resolvedUserName}</p>
            </div>
          </div>

          <div className="hidden md:block">
            <WalletMenu />
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="h-9 w-9 md:hidden" aria-label="Open quick actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56 md:hidden">
              <DropdownMenuLabel className="truncate">{resolvedUserName}</DropdownMenuLabel>
              <DropdownMenuItem disabled className="text-xs">
                {effectiveUserStatus}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={toggleTheme}>Toggle theme</DropdownMenuItem>
              {authUser?.role === "investor" ? (
                <DropdownMenuItem asChild>
                  <Link href="/dashboard/investor/wallet">Open wallet</Link>
                </DropdownMenuItem>
              ) : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
