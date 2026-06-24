"use client"

import { useCallback, useEffect, useMemo, useState, type ComponentType } from "react"
import Link from "next/link"
import {
  AlertCircle,
  Car,
  Check,
  CircleDollarSign,
  ExternalLink,
  FileCheck2,
  Landmark,
  Orbit,
  RefreshCw,
  Settings,
  Wallet,
} from "lucide-react"

import { publishActivityUnreadCount } from "@/components/dashboard/activity-unread-bell"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { ACTIVITY_CATEGORIES, ACTIVITY_CATEGORY_LABELS, type ActivityCategory, type ActivityItem } from "@/lib/activity"
import { cn } from "@/lib/utils"

const categoryIcons: Record<ActivityCategory, ComponentType<{ className?: string }>> = {
  wallet: Wallet,
  investment: Landmark,
  repayment: CircleDollarSign,
  kyc: FileCheck2,
  vehicle: Car,
  payout: CircleDollarSign,
  stellar: Orbit,
  system: Settings,
}

type Filter = "all" | "unread" | ActivityCategory

export function ActivityFeed() {
  const [activities, setActivities] = useState<ActivityItem[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [filter, setFilter] = useState<Filter>("all")
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [updating, setUpdating] = useState(false)

  const loadActivities = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/activity", { cache: "no-store" })
      if (!response.ok) throw new Error("The activity feed could not be loaded.")
      const data = await response.json()
      setActivities(data.activities || [])
      setUnreadCount(data.unreadCount || 0)
      publishActivityUnreadCount(data.unreadCount || 0)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "The activity feed could not be loaded.")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadActivities()
  }, [loadActivities])

  const visibleActivities = useMemo(() => {
    if (filter === "all") return activities
    if (filter === "unread") return activities.filter((activity) => !activity.read)
    return activities.filter((activity) => activity.category === filter)
  }, [activities, filter])

  const setRead = async (activityId: string, read: boolean) => {
    const current = activities.find((activity) => activity.id === activityId)
    if (!current || current.read === read) return

    setActivities((items) => items.map((item) => (item.id === activityId ? { ...item, read } : item)))
    const nextCount = Math.max(0, unreadCount + (read ? -1 : 1))
    setUnreadCount(nextCount)
    publishActivityUnreadCount(nextCount)

    const response = await fetch("/api/activity", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "set-read", activityId, read }),
    })
    if (!response.ok) void loadActivities()
  }

  const markAllRead = async () => {
    setUpdating(true)
    try {
      const response = await fetch("/api/activity", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mark-all-read" }),
      })
      if (!response.ok) throw new Error()
      setActivities((items) => items.map((item) => ({ ...item, read: true })))
      setUnreadCount(0)
      publishActivityUnreadCount(0)
    } catch {
      setError("Read state could not be updated. Please try again.")
    } finally {
      setUpdating(false)
    }
  }

  return (
    <Card className="overflow-hidden border-border/70">
      <CardHeader className="border-b border-border/60">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle>Recent activity</CardTitle>
            <CardDescription className="mt-1">Account and platform updates relevant to your role.</CardDescription>
          </div>
          <Button variant="outline" size="sm" onClick={markAllRead} disabled={!unreadCount || updating}>
            <Check className="mr-2 h-4 w-4" />
            Mark all read
          </Button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1 pt-3" aria-label="Activity filters">
          {(["all", "unread", ...ACTIVITY_CATEGORIES] as Filter[]).map((value) => (
            <Button
              key={value}
              type="button"
              variant={filter === value ? "default" : "outline"}
              size="sm"
              className="shrink-0 capitalize"
              onClick={() => setFilter(value)}
            >
              {value === "unread" ? `Unread (${unreadCount})` : value === "all" ? "All" : ACTIVITY_CATEGORY_LABELS[value]}
            </Button>
          ))}
        </div>
      </CardHeader>

      <CardContent className="p-0">
        {loading ? (
          <div className="space-y-0" aria-label="Loading activity">
            {[0, 1, 2].map((item) => (
              <div key={item} className="flex gap-4 border-b border-border/50 p-5 last:border-0">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2"><Skeleton className="h-4 w-1/3" /><Skeleton className="h-3 w-2/3" /></div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-5">
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Unable to load activity</AlertTitle>
              <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <span>{error}</span>
                <Button variant="outline" size="sm" onClick={loadActivities}><RefreshCw className="mr-2 h-4 w-4" />Retry</Button>
              </AlertDescription>
            </Alert>
          </div>
        ) : visibleActivities.length === 0 ? (
          <div className="px-5 py-16 text-center">
            <Check className="mx-auto h-8 w-8 text-muted-foreground" />
            <h3 className="mt-3 font-medium">You’re all caught up</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {filter === "all" ? "New activity will appear here as it happens." : "There is no activity matching this filter."}
            </p>
          </div>
        ) : (
          <ol className="divide-y divide-border/60">
            {visibleActivities.map((activity) => {
              const Icon = categoryIcons[activity.category]
              return (
                <li key={activity.id} className={cn("relative flex gap-4 p-5", !activity.read && "bg-primary/[0.035]")}>
                  <div className="relative flex shrink-0 flex-col items-center">
                    <span className="flex h-10 w-10 items-center justify-center rounded-full border bg-background"><Icon className="h-4 w-4" /></span>
                    {!activity.read ? <span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full bg-primary ring-2 ring-background" /> : null}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-medium">{activity.title}</h3>
                      <Badge variant="secondary">{ACTIVITY_CATEGORY_LABELS[activity.category]}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">{activity.message}</p>
                    <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                      <time dateTime={activity.timestamp}>{new Date(activity.timestamp).toLocaleString()}</time>
                      {activity.link ? (
                        <Link href={activity.link} onClick={() => void setRead(activity.id, true)} className="inline-flex items-center font-medium text-primary hover:underline">
                          View details <ExternalLink className="ml-1 h-3 w-3" />
                        </Link>
                      ) : null}
                      <button type="button" onClick={() => void setRead(activity.id, !activity.read)} className="font-medium text-foreground hover:underline">
                        Mark as {activity.read ? "unread" : "read"}
                      </button>
                    </div>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
