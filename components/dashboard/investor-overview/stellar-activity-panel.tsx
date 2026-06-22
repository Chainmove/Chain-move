"use client"

import { useEffect, useMemo, useState } from "react"
import { ExternalLink, Loader2, RefreshCw, Sparkles } from "lucide-react"
import { format } from "date-fns"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Skeleton } from "@/components/ui/skeleton"
import { cn } from "@/lib/utils"
import { getStellarDisplayConfig, getStellarNetworkLabel } from "@/lib/stellar/display-config"
import { createMockStellarActivityFeed, type StellarActivityItem } from "@/lib/stellar/mock-activity"

export interface StellarActivityPanelData {
  linkedAccount: string | null
  activities: StellarActivityItem[]
}

interface StellarActivityPanelProps {
  data: StellarActivityPanelData | null
  isLoading: boolean
  error: string | null
  onRetry?: () => void
  onRefresh?: () => void
  isRefreshing?: boolean
  className?: string
}

function truncatePublicKey(publicKey: string) {
  if (publicKey.length <= 18) {
    return publicKey
  }

  return `${publicKey.slice(0, 8)}...${publicKey.slice(-8)}`
}

function formatActivityDate(value: string) {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return "Recently"
  }

  return format(date, "MMM d, yyyy")
}

function getStatusVariant(status: StellarActivityItem["status"]) {
  switch (status) {
    case "Confirmed":
      return "green"
    case "Pending":
      return "secondary"
    case "Failed":
      return "red"
    default:
      return "outline"
  }
}

function StellarActivitySkeleton() {
  return (
    <div className="space-y-4">
      <div className="grid gap-3 rounded-2xl border bg-muted/20 p-4 md:grid-cols-[minmax(0,1fr)_180px] md:items-center">
        <div className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-6 w-full max-w-[420px]" />
        </div>
        <Skeleton className="h-10 w-full md:justify-self-end md:w-[180px]" />
      </div>

      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-xl border border-border/70 p-4">
            <Skeleton className="h-4 w-36" />
            <Skeleton className="mt-3 h-5 w-48" />
            <Skeleton className="mt-4 h-4 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}

function StellarActivityEmptyState() {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/20 p-6 text-sm text-muted-foreground">
      No Stellar account is linked yet. Connect a public testnet account to start tracking activity here.
    </div>
  )
}

function StellarActivityErrorState({ error, onRetry }: { error: string; onRetry?: () => void }) {
  return (
    <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
      <p className="font-medium">Unable to load Stellar activity.</p>
      <p className="mt-1">{error}</p>
      {onRetry ? (
        <Button className="mt-4" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      ) : null}
    </div>
  )
}

export function StellarActivityPanel({
  data,
  isLoading,
  error,
  onRetry,
  onRefresh,
  isRefreshing = false,
  className,
}: StellarActivityPanelProps) {
  const config = useMemo(() => getStellarDisplayConfig(), [])
  const networkLabel = getStellarNetworkLabel(config.network)

  return (
    <Card className={cn("scroll-mt-24", className)}>
      <CardHeader>
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div className="space-y-1">
            <CardTitle className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400" />
              Stellar activity
            </CardTitle>
            <CardDescription>
              Linked testnet account activity, including transaction references pulled from the Stellar config.
            </CardDescription>
          </div>

          {onRefresh ? (
            <Button type="button" variant="outline" size="sm" onClick={onRefresh} className="w-full md:w-auto">
              <RefreshCw className={cn("mr-2 h-4 w-4", isRefreshing ? "animate-spin" : "")} />
              Refresh
            </Button>
          ) : null}
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <Badge variant="secondary">Network: {networkLabel}</Badge>
          <Badge variant="outline">{config.mock ? "Mock/testnet feed" : "Read-only feed"}</Badge>
        </div>

        {isLoading ? (
          <StellarActivitySkeleton />
        ) : error ? (
          <StellarActivityErrorState error={error} onRetry={onRetry} />
        ) : !data?.linkedAccount ? (
          <StellarActivityEmptyState />
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 rounded-2xl border bg-muted/20 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">Linked Stellar public account</p>
                <p className="mt-2 break-all font-mono text-sm font-medium text-foreground">
                  {truncatePublicKey(data.linkedAccount)}
                </p>
              </div>

              <div className="flex flex-wrap gap-2 md:justify-end">
                <Badge variant="green">Linked</Badge>
                <Badge variant="secondary">{data.activities.length} recent items</Badge>
              </div>
            </div>

            {data.activities.length === 0 ? (
              <StellarActivityEmptyState />
            ) : (
              <>
                <div className="space-y-3 md:hidden">
                  {data.activities.map((activity) => (
                    <article key={activity.id} className="rounded-xl border border-border/70 p-4">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">{activity.type}</p>
                          <p className="mt-1 text-xs text-muted-foreground">{formatActivityDate(activity.date)}</p>
                        </div>
                        <Badge variant={getStatusVariant(activity.status)}>{activity.status}</Badge>
                      </div>

                      <div className="mt-3 flex items-baseline justify-between gap-3">
                        <p className="text-sm text-muted-foreground">Amount / Asset</p>
                        <p className="font-semibold text-foreground">
                          {activity.amount} {activity.asset}
                        </p>
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-3">
                        <p className="text-sm text-muted-foreground">Reference</p>
                        {activity.reference ? (
                          <a
                            href={activity.reference}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm font-medium text-amber-700 underline-offset-4 hover:underline dark:text-amber-400"
                          >
                            Open
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                        ) : (
                          <span className="text-sm text-muted-foreground">Unavailable</span>
                        )}
                      </div>
                    </article>
                  ))}
                </div>

                <div className="hidden overflow-hidden rounded-2xl border md:block">
                  <div className="overflow-x-auto">
                    <table className="min-w-full divide-y divide-border">
                      <thead className="bg-muted/20">
                        <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
                          <th className="px-4 py-3 font-medium">Activity type</th>
                          <th className="px-4 py-3 font-medium">Amount / Asset</th>
                          <th className="px-4 py-3 font-medium">Date</th>
                          <th className="px-4 py-3 font-medium">Status</th>
                          <th className="px-4 py-3 font-medium">Reference</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border bg-background">
                        {data.activities.map((activity) => (
                          <tr key={activity.id} className="align-top">
                            <td className="px-4 py-4">
                              <p className="font-medium text-foreground">{activity.type}</p>
                            </td>
                            <td className="px-4 py-4">
                              <p className="font-medium text-foreground">
                                {activity.amount} {activity.asset}
                              </p>
                            </td>
                            <td className="px-4 py-4 text-sm text-muted-foreground">{formatActivityDate(activity.date)}</td>
                            <td className="px-4 py-4">
                              <Badge variant={getStatusVariant(activity.status)}>{activity.status}</Badge>
                            </td>
                            <td className="px-4 py-4">
                              {activity.reference ? (
                                <a
                                  href={activity.reference}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex items-center gap-1 text-sm font-medium text-amber-700 underline-offset-4 hover:underline dark:text-amber-400"
                                >
                                  View reference
                                  <ExternalLink className="h-3.5 w-3.5" />
                                </a>
                              ) : (
                                <span className="text-sm text-muted-foreground">Unavailable</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function InvestorStellarActivityPanel({ className }: { className?: string }) {
  const config = useMemo(() => getStellarDisplayConfig(), [])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [data, setData] = useState<StellarActivityPanelData | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)

  const linkedAccount = config.mock ? config.demoPublicKey : null

  const loadFeed = async () => {
    try {
      const feed = createMockStellarActivityFeed(linkedAccount)
      setData(feed)
      setError(null)
    } catch (loadError) {
      setData(null)
      setError(loadError instanceof Error ? loadError.message : "Unable to load Stellar activity.")
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadFeed()
    }, 300)

    return () => {
      window.clearTimeout(timeout)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [linkedAccount])

  return (
    <StellarActivityPanel
      className={className}
      data={data}
      isLoading={isLoading}
      error={error}
      onRetry={() => {
        setIsLoading(true)
        void loadFeed()
      }}
      onRefresh={() => {
        setIsRefreshing(true)
        void loadFeed()
      }}
      isRefreshing={isRefreshing}
    />
  )
}
