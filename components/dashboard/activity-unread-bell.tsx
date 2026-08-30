"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Bell } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface ActivityUnreadBellProps {
  role?: "driver" | "investor" | "admin"
  fallbackCount?: number
  compact?: boolean
  className?: string
}

export const ACTIVITY_COUNT_CHANGED_EVENT = "chainmove:activity-count-changed"

export function publishActivityUnreadCount(unreadCount: number) {
  window.dispatchEvent(new CustomEvent(ACTIVITY_COUNT_CHANGED_EVENT, { detail: unreadCount }))
}

export function ActivityUnreadBell({ role, fallbackCount = 0, compact = false, className }: ActivityUnreadBellProps) {
  const [unreadCount, setUnreadCount] = useState(fallbackCount)

  useEffect(() => {
    if (role) {
      fetch("/api/activity?limit=1", { cache: "no-store" })
        .then((response) => (response.ok ? response.json() : null))
        .then((data) => {
          if (data) setUnreadCount(data.unreadCount || 0)
        })
        .catch(() => {
          // Keep the last known count; the activity page exposes a retry state.
        })
    }
    const updateCount = (event: Event) => setUnreadCount((event as CustomEvent<number>).detail)
    window.addEventListener(ACTIVITY_COUNT_CHANGED_EVENT, updateCount)
    return () => window.removeEventListener(ACTIVITY_COUNT_CHANGED_EVENT, updateCount)
  }, [role])

  const href = role ? `/dashboard/${role}/activity` : "#"
  return (
    <Button
      asChild={Boolean(role)}
      variant="ghost"
      size="icon"
      className={cn(
        "relative rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
        compact ? "h-8 w-8" : "h-9 w-9 rounded-full",
        className,
      )}
      aria-label={unreadCount ? `Activity, ${unreadCount} unread` : "Activity"}
    >
      {role ? (
        <Link href={href}>
          <Bell className={compact ? "h-4 w-4" : "h-[1.2rem] w-[1.2rem]"} />
          {unreadCount > 0 ? (
            <span className="absolute -right-1 -top-1 inline-flex min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[9px] font-semibold text-white">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          ) : null}
        </Link>
      ) : (
        <Bell className={compact ? "h-4 w-4" : "h-[1.2rem] w-[1.2rem]"} />
      )}
    </Button>
  )
}
