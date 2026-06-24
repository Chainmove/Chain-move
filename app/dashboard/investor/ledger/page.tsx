"use client"

import { useRouter } from "next/navigation"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"
import { Header } from "@/components/dashboard/header"
import { TransactionLedger } from "@/components/dashboard/ledger/transaction-ledger"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAuth } from "@/hooks/use-auth"

export default function InvestorLedgerPage() {
  const router = useRouter()
  const { user: authUser, loading: authLoading } = useAuth()

  if (authLoading) {
    return (
      <DashboardRouteLoading
        title="Loading transaction ledger"
        description="Preparing your wallet ledger and transaction history."
      />
    )
  }

  if (!authUser || authUser.role !== "investor") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>You need an investor account to access this page.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => router.push("/signin")} className="w-full">
              Go to Sign in
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <DashboardShell role="investor" header={<Header userStatus="Verified Investor" />}>
      <main className="min-w-0 p-4 sm:p-6 lg:p-8">
        <TransactionLedger
          role="investor"
          description="Your wallet funding, investments, payouts, and reconciliation status."
        />
      </main>
    </DashboardShell>
  )
}
