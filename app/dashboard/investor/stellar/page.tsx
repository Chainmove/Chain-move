"use client"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { Header } from "@/components/dashboard/header"
import { StellarActivityDashboard } from "@/components/dashboard/stellar-activity-dashboard"
import { useAuth } from "@/hooks/use-auth"
import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"
import { DashboardUnauthorized } from "@/components/dashboard/dashboard-unauthorized"

export default function InvestorStellarPage() {
  const { user: authUser, loading: authLoading } = useAuth()

  if (authLoading) {
    return (
      <DashboardRouteLoading
        title="Loading Stellar Dashboard"
        description="Preparing asset ownership records and payment timeline."
      />
    )
  }

  if (!authUser || authUser.role !== "investor") {
    return <DashboardUnauthorized requiredRoles={["investor"]} currentRole={authUser?.role} />
  }

  return (
    <DashboardShell role="investor" header={<Header userStatus="Verified Investor" />}>
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">
        <StellarActivityDashboard role="investor" />
      </main>
    </DashboardShell>
  )
}
