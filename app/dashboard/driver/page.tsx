import Link from "next/link"
import { redirect } from "next/navigation"
import { AlertTriangle, ArrowRight, Calendar, CheckCircle, Wallet } from "lucide-react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { DashboardHeader } from "@/components/dashboard/investor-overview/dashboard-header"
import { MetricsRow, type OverviewMetricItem } from "@/components/dashboard/investor-overview/metrics-row"
import { ContractSummaryCard } from "@/components/dashboard/driver-hire-purchase/contract-summary-card"
import { DriverPaymentsTable } from "@/components/dashboard/driver-hire-purchase/driver-payments-table"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { formatNaira } from "@/lib/currency"
import dbConnect from "@/lib/dbConnect"
import { requireDashboardSession } from "@/lib/auth/dashboard-guard"
import { getDriverContract, getDriverPayments } from "@/lib/services/driver-contracts.service"
import User from "@/models/User"

export const dynamic = "force-dynamic"

function resolveDisplayName(user: { fullName?: string; name?: string; email?: string | null }) {
  if (user.fullName && user.fullName.trim()) return user.fullName.trim()
  if (user.name && user.name.trim()) return user.name.trim()
  if (user.email) return user.email.split("@")[0]
  return "Driver"
}

function formatDateLabel(value: string | null) {
  if (!value) return "Not scheduled"
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return "Not scheduled"
  return date.toLocaleDateString("en-NG", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })
}

export default async function DriverDashboardPage() {
  const session = await requireDashboardSession("driver")

  await dbConnect()
  const user = await User.findById(session.userId).select("name fullName email role")

  if (!user) {
    redirect("/signin")
  }

  const driverName = resolveDisplayName({
    fullName: user.fullName,
    name: user.name,
    email: user.email,
  })
  const contract = await getDriverContract(user._id.toString())
  const recentPayments = contract
    ? await getDriverPayments({
        driverUserId: user._id.toString(),
        contractId: contract.id,
        limit: 5,
      })
    : []

  const metrics: OverviewMetricItem[] = contract
    ? [
        {
          id: "outstanding-balance",
          label: "Outstanding Balance",
          value: formatNaira(contract.remainingBalanceNgn),
          hint: "Remaining hire-purchase amount.",
        },
        {
          id: "total-paid",
          label: "Total Paid",
          value: formatNaira(contract.totalPaidNgn),
          hint: "Total repayments confirmed so far.",
        },
        {
          id: "next-due-date",
          label: "Next Due Date",
          value: formatDateLabel(contract.nextDueDate),
          hint: `Installment amount ${formatNaira(contract.nextPaymentAmountNgn)}.`,
        },
        {
          id: "repayment-progress",
          label: "Repayment Progress",
          value: `${Math.round(contract.progressRatio * 100)}%`,
          hint: `${formatNaira(contract.totalPaidNgn)} of ${formatNaira(contract.totalPayableNgn)} paid.`,
        },
      ]
    : [
        {
          id: "outstanding-balance",
          label: "Outstanding Balance",
          value: formatNaira(0),
          hint: "No active contract assigned.",
        },
        {
          id: "total-paid",
          label: "Total Paid",
          value: formatNaira(0),
          hint: "Repayment history will appear once contract starts.",
        },
        {
          id: "next-due-date",
          label: "Next Due Date",
          value: "Not scheduled",
          hint: "No active repayment schedule.",
        },
        {
          id: "repayment-progress",
          label: "Repayment Progress",
          value: "0%",
          hint: "No active contract.",
        },
      ]

  const showDueAlert = Boolean(contract && contract.status === "ACTIVE" && contract.nextDueDate)

  return (
    <DashboardShell
      role="driver"
      sidebarWidth="compact"
      header={<DashboardHeader title="Dashboard" welcomeName={driverName} />}
    >
      <main className="min-w-0 space-y-4 p-4 md:p-6">
        {showDueAlert ? (
          <section className="rounded-[10px] border border-red-300 bg-red-50 px-4 py-3 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-300">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="inline-flex items-start">
                <AlertTriangle className="mr-2 mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="text-sm font-semibold">Repayment due soon</p>
                  <p className="text-sm">
                    Your next payment of {formatNaira(contract?.nextPaymentAmountNgn || 0)} is due on{" "}
                    {formatDateLabel(contract?.nextDueDate || null)}.
                  </p>
                </div>
              </div>
              <Button asChild size="sm" className="w-full bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 sm:w-auto">
                <Link href="/dashboard/driver/repayment">Pay now</Link>
              </Button>
            </div>
          </section>
        ) : null}

        <section className="rounded-[10px] border border-border/70 bg-card px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold leading-tight text-foreground md:text-2xl">Hire Purchase Overview</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Track your assigned vehicle contract, outstanding balance, and repayment performance.
              </p>
            </div>

            <Button asChild className="h-10 w-full bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 sm:w-auto">
              <Link href="/dashboard/driver/repayment">
                <Wallet className="mr-2 h-4 w-4" />
                Make Payment
              </Link>
            </Button>
          </div>
        </section>

        <MetricsRow metrics={metrics} />

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_1fr]">
          {contract ? (
            <ContractSummaryCard contract={contract} />
          ) : (
            <Card className="rounded-[10px] border border-border/70 bg-card">
              <CardHeader>
                <CardTitle>No Contract Assigned</CardTitle>
                <CardDescription>
                  You do not have an active hire-purchase contract yet.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild variant="outline">
                  <Link href="/dashboard/driver/settings">Open account settings</Link>
                </Button>
              </CardContent>
            </Card>
          )}

          <section className="rounded-[10px] border border-border/70 bg-card p-4 md:p-5">
            <div className="mb-4">
              <h3 className="text-lg font-semibold text-foreground">Make a Payment</h3>
              <p className="mt-1 text-sm text-muted-foreground">Pay weekly installments in fiat NGN only.</p>
            </div>

            {contract ? (
              <div className="space-y-3">
                <article className="rounded-[10px] border border-border/70 px-3 py-3">
                  <p className="text-xs text-muted-foreground">Next installment</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">
                    {formatNaira(contract.nextPaymentAmountNgn)}
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Due {formatDateLabel(contract.nextDueDate)}
                  </p>
                </article>

                <article className="rounded-[10px] border border-border/70 px-3 py-3">
                  <p className="text-xs text-muted-foreground">Outstanding balance</p>
                  <p className="mt-1 text-xl font-semibold text-foreground">
                    {formatNaira(contract.remainingBalanceNgn)}
                  </p>
                  <p className="mt-1 inline-flex items-center text-xs text-emerald-700 dark:text-emerald-400">
                    <CheckCircle className="mr-1 h-3.5 w-3.5" />
                    Progress {Math.round(contract.progressRatio * 100)}%
                  </p>
                </article>

                <Button asChild className="h-10 w-full bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400">
                  <Link href="/dashboard/driver/repayment">
                    Continue to payment
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="rounded-[10px] border border-dashed border-border px-4 py-8 text-center">
                <Calendar className="mx-auto h-5 w-5 text-muted-foreground" />
                <p className="mt-2 text-sm text-muted-foreground">
                  Contract details will appear once assigned by the operations team.
                </p>
              </div>
            )}
          </section>
        </section>

        <section className="rounded-[10px] border border-border/70 bg-card p-4 md:p-5">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Recent Payments</h3>
              <p className="mt-1 text-sm text-muted-foreground">Latest repayment transactions on your contract.</p>
            </div>
            <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
              <Link href="/dashboard/driver/payments">View full history</Link>
            </Button>
          </div>
          <DriverPaymentsTable payments={recentPayments} emptyLabel="No repayments have been made yet." />
        </section>
      </main>
    </DashboardShell>
  )
}
