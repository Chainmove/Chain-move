"use client"

import { ChevronDown, Menu, MoreVertical, User } from "lucide-react"

import { emitDashboardSidebarToggle } from "@/components/dashboard/sidebar-events"
import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { ActivityUnreadBell } from "@/components/dashboard/activity-unread-bell"
import { useAuth } from "@/hooks/use-auth"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

interface DashboardHeaderProps {
  title?: string
  welcomeName: string
  walletChipLabel?: string | null
  onWalletChipClick?: () => void
  notificationCount?: number
}

export function DashboardHeader({
  title = "Dashboard",
  welcomeName,
  walletChipLabel,
  onWalletChipClick,
  notificationCount = 0,
}: DashboardHeaderProps) {
  const { user } = useAuth()

  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/95 backdrop-blur">
      <div className="flex h-[60px] items-center justify-between px-4 md:px-6">
        <div className="flex min-w-0 items-center gap-2">
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

          <div className="min-w-0">
            <h1 className="truncate text-lg font-semibold leading-none text-foreground md:text-xl">{title}</h1>
            <p className="mt-1 hidden truncate text-sm text-muted-foreground sm:block">Welcome back, {welcomeName}</p>
          </div>
        </div>

        <div className="flex items-center gap-2 md:gap-3">
          <ThemeToggle className="hidden h-8 w-8 rounded-md text-muted-foreground hover:bg-muted md:inline-flex" />

          <ActivityUnreadBell
            role={user?.role === "driver" || user?.role === "investor" || user?.role === "admin" ? user.role : undefined}
            fallbackCount={notificationCount}
            compact
          />

          <button
            type="button"
            className="inline-flex h-8 items-center gap-1 rounded-full bg-muted px-2 text-muted-foreground"
            aria-label="Profile menu"
          >
            <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-border bg-background">
              <User className="h-3.5 w-3.5" />
            </span>
            <ChevronDown className="h-3.5 w-3.5" />
          </button>

          {walletChipLabel ? (
            <button
              type="button"
              onClick={onWalletChipClick}
              className="hidden h-8 items-center rounded-md bg-amber-600 px-4 text-xs font-semibold text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 md:inline-flex"
            >
              {walletChipLabel}
            </button>
          ) : null}

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button type="button" variant="outline" size="icon" className="h-8 w-8 md:hidden" aria-label="Open quick actions">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52 md:hidden">
              <DropdownMenuLabel className="truncate">{welcomeName}</DropdownMenuLabel>
              {walletChipLabel ? (
                <DropdownMenuItem onClick={onWalletChipClick}>Open wallet</DropdownMenuItem>
              ) : null}
              <DropdownMenuItem onClick={emitDashboardSidebarToggle}>Open menu</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
