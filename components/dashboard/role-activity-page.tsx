"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"

import { ActivityFeed } from "@/components/dashboard/activity-feed"
import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"
import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { Header } from "@/components/dashboard/header"
import { useAuth } from "@/hooks/use-auth"

interface RoleActivityPageProps {
  role: "driver" | "investor"
}

export function RoleActivityPage({ role }: RoleActivityPageProps) {
  const { user, loading } = useAuth()
  const router = useRouter()

  useEffect(() => {
    if (!loading && (!user || user.role !== role)) router.replace("/signin")
  }, [loading, role, router, user])

  if (loading || !user) {
    return <DashboardRouteLoading title="Loading activity" description="Fetching your latest platform updates." />
  }
  if (user.role !== role) return null

  return (
    <DashboardShell role={role} sidebarWidth={role === "driver" ? "compact" : "default"} header={<Header />}>
      <main className="mx-auto w-full max-w-5xl space-y-5 p-4 md:p-6">
        <section>
          <h1 className="text-2xl font-semibold tracking-tight">Activity</h1>
          <p className="mt-1 text-sm text-muted-foreground">Follow important account events in one timeline.</p>
        </section>
        <ActivityFeed />
      </main>
    </DashboardShell>
  )
}
