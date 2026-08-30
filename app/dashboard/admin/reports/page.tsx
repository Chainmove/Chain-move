import Link from "next/link"
import { Download, Printer } from "lucide-react"

import { PageHeader } from "@/components/dashboard/admin/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { formatNaira } from "@/lib/currency"
import dbConnect from "@/lib/dbConnect"
import DriverPayment from "@/models/DriverPayment"
import Investment from "@/models/Investment"
import InvestmentPool from "@/models/InvestmentPool"
import InvestorCredit from "@/models/InvestorCredit"
import PoolInvestment from "@/models/PoolInvestment"
import Transaction from "@/models/Transaction"
import User from "@/models/User"
import Vehicle from "@/models/Vehicle"
import { requireAdminAccess } from "@/src/server/admin/require-admin"

export const dynamic = "force-dynamic"

interface ReportsPageProps {
  searchParams?: Promise<Record<string, string | string[] | undefined>>
}

type ReportRange = "7d" | "30d" | "90d" | "all" | "custom"
type ReportTab = "overview" | "kyc" | "fleet" | "users"

function getParam(value: string | string[] | undefined, fallback = "") {
  if (Array.isArray(value)) return value[0] ?? fallback
  return value ?? fallback
}

function buildWindow(range: ReportRange, fromRaw: string, toRaw: string) {
  if (range === "all") return { startDate: null as Date | null, endDate: null as Date | null }

  if (range === "custom") {
    const fromDate = fromRaw ? new Date(fromRaw) : null
    const toDate = toRaw ? new Date(toRaw) : null
    if (fromDate && toDate && !Number.isNaN(fromDate.getTime()) && !Number.isNaN(toDate.getTime())) {
      const endDate = new Date(toDate)
      endDate.setHours(23, 59, 59, 999)
      return { startDate: fromDate, endDate }
    }
  }

  const days = range === "7d" ? 7 : range === "90d" ? 90 : 30
  const startDate = new Date()
  startDate.setDate(startDate.getDate() - days)
  return { startDate, endDate: null as Date | null }
}

function buildDateMatch(field: string, startDate: Date | null, endDate: Date | null) {
  if (!startDate && !endDate) return {}
  const clause: Record<string, Date> = {}
  if (startDate) clause.$gte = startDate
  if (endDate) clause.$lte = endDate
  return { [field]: clause }
}

function hrefForRange(range: ReportRange, from: string, to: string) {
  const params = new URLSearchParams()
  params.set("range", range)
  if (range === "custom") {
    if (from) params.set("from", from)
    if (to) params.set("to", to)
  }
  return `/dashboard/admin/reports?${params.toString()}`
}

function hrefForTab(tab: ReportTab, range: ReportRange, from: string, to: string) {
  const params = new URLSearchParams()
  params.set("tab", tab)
  params.set("range", range)
  if (range === "custom") {
    if (from) params.set("from", from)
    if (to) params.set("to", to)
  }
  return `/dashboard/admin/reports?${params.toString()}`
}

function kycBadgeVariant(status: string) {
  if (status === "approved") return "default"
  if (status === "rejected") return "destructive"
  if (status === "pending") return "secondary"
  return "outline"
}

function vehicleStatusVariant(status: string) {
  if (status === "Available") return "default"
  if (status === "Financed" || status === "Reserved") return "secondary"
  if (status === "Maintenance") return "destructive"
  return "outline"
}

export default async function AdminReportsPage({ searchParams }: ReportsPageProps) {
  await requireAdminAccess()
  await dbConnect()

  const resolved = (await searchParams) || {}
  const rawRange = getParam(resolved.range, "30d")
  const range: ReportRange = ["7d", "30d", "90d", "all", "custom"].includes(rawRange) ? (rawRange as ReportRange) : "30d"
  const from = getParam(resolved.from)
  const to = getParam(resolved.to)
  const rawTab = getParam(resolved.tab, "overview")
  const tab: ReportTab = ["overview", "kyc", "fleet", "users"].includes(rawTab) ? (rawTab as ReportTab) : "overview"
  const kycStatusFilter = getParam(resolved.status)
  const vehicleStatusFilter = getParam(resolved.vstatus)
  const roleFilter = getParam(resolved.role)

  const { startDate, endDate } = buildWindow(range, from, to)
  const txDateMatch = buildDateMatch("timestamp", startDate, endDate)
  const poolInvestDateMatch = buildDateMatch("createdAt", startDate, endDate)
  const legacyInvestDateMatch = buildDateMatch("date", startDate, endDate)
  const paymentDateMatch = buildDateMatch("createdAt", startDate, endDate)
  const poolsDateMatch = buildDateMatch("createdAt", startDate, endDate)
  const userDateMatch = buildDateMatch("createdAt", startDate, endDate)

  // Tab-specific data
  let kycStatusCounts: Array<{ _id: string; count: number }> = []
  let recentKyc: any[] = []
  let vehicleStatusCounts: Array<{ _id: string; count: number }> = []
  let recentVehicles: any[] = []
  let userRoleCounts: Array<{ _id: string; count: number }> = []
  let recentUsers: any[] = []

  const [depositsAgg, poolInvestAgg, legacyInvestAgg, repaymentsAgg, creditsAgg, poolSummary] = await Promise.all([
    Transaction.aggregate([
      {
        $match: {
          type: { $in: ["deposit", "wallet_funding"] },
          status: { $in: ["Completed", "completed", "SUCCESS", "success", "Successful", "successful"] },
          ...txDateMatch,
        },
      },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    PoolInvestment.aggregate([
      { $match: { status: "CONFIRMED", ...poolInvestDateMatch } },
      { $group: { _id: null, total: { $sum: "$amountNgn" } } },
    ]),
    Investment.aggregate([
      { $match: { status: { $in: ["Active", "Completed"] }, ...legacyInvestDateMatch } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ]),
    DriverPayment.aggregate([
      { $match: { status: "CONFIRMED", ...paymentDateMatch } },
      {
        $group: {
          _id: null,
          total: {
            $sum: {
              $cond: [{ $gt: ["$appliedAmountNgn", 0] }, "$appliedAmountNgn", "$amountNgn"],
            },
          },
        },
      },
    ]),
    InvestorCredit.aggregate([
      { $match: { status: "POSTED", ...paymentDateMatch } },
      { $group: { _id: null, total: { $sum: "$amountNgn" } } },
    ]),
    InvestmentPool.aggregate([
      { $match: poolsDateMatch },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]),
  ])

  const totalDeposits = Number(depositsAgg[0]?.total || 0)
  const totalInvested = Number(poolInvestAgg[0]?.total || 0) + Number(legacyInvestAgg[0]?.total || 0)
  const totalRepayments = Number(repaymentsAgg[0]?.total || 0)
  const totalCredits = Number(creditsAgg[0]?.total || 0)
  const openPools = Number(poolSummary.find((entry: any) => String(entry._id).toUpperCase() === "OPEN")?.count || 0)
  const fundedPools = Number(poolSummary.find((entry: any) => String(entry._id).toUpperCase() === "FUNDED")?.count || 0)
  const activePools = openPools + fundedPools

  if (tab === "users") {
    const uQuery: Record<string, unknown> = { ...userDateMatch }
    if (["driver", "investor", "admin"].includes(roleFilter)) uQuery.role = roleFilter
    ;[userRoleCounts, recentUsers] = await Promise.all([
      User.aggregate([{ $group: { _id: "$role", count: { $sum: 1 } } }]),
      User.find(uQuery).select("name fullName email role kycVerified createdAt").sort({ createdAt: -1 }).limit(15).lean(),
    ])
  }

  if (tab === "fleet") {
    const vQuery: Record<string, unknown> = {}
    if (["Available", "Financed", "Reserved", "Maintenance", "Retired"].includes(vehicleStatusFilter)) vQuery.status = vehicleStatusFilter
    ;[vehicleStatusCounts, recentVehicles] = await Promise.all([
      Vehicle.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]),
      Vehicle.find(vQuery).select("name identifier type year price status fundingStatus totalFundedAmount addedDate").sort({ addedDate: -1 }).limit(15).lean(),
    ])
  }

  if (tab === "kyc") {
    const kycQuery: Record<string, unknown> = { kycStatus: { $nin: ["none", null] } }
    if (["pending", "approved", "rejected"].includes(kycStatusFilter)) kycQuery.kycStatus = kycStatusFilter
    ;[kycStatusCounts, recentKyc] = await Promise.all([
      User.aggregate([{ $match: { kycStatus: { $nin: ["none", null] } } }, { $group: { _id: "$kycStatus", count: { $sum: 1 } } }]),
      User.find(kycQuery).select("name fullName email role kycStatus kycVerified createdAt").sort({ createdAt: -1 }).limit(15).lean(),
    ])
  }

  const exportQuery = new URLSearchParams()
  exportQuery.set("range", range)
  if (range === "custom") {
    if (from) exportQuery.set("from", from)
    if (to) exportQuery.set("to", to)
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Reports"
        subtitle="Platform reporting hub and exports."
        actions={
          <div className="flex flex-wrap items-center gap-2 print:hidden">
            <form action="/dashboard/admin/reports" className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="tab" value={tab} />
              <select name="range" defaultValue={range} className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground">
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="all">All time</option>
                <option value="custom">Custom range</option>
              </select>
              <input type="date" name="from" defaultValue={from} className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground" />
              <input type="date" name="to" defaultValue={to} className="h-9 rounded-md border border-input bg-background px-3 text-sm text-foreground" />
              <Button type="submit" variant="outline" className="h-9">Apply</Button>
            </form>
          </div>
        }
      />

      <div className="flex flex-wrap gap-2">
        <Button asChild variant={range === "7d" ? "default" : "outline"} size="sm">
          <Link href={hrefForRange("7d", from, to)}>Last 7 Days</Link>
        </Button>
        <Button asChild variant={range === "30d" ? "default" : "outline"} size="sm">
          <Link href={hrefForRange("30d", from, to)}>Last 30 Days</Link>
        </Button>
        <Button asChild variant={range === "90d" ? "default" : "outline"} size="sm">
          <Link href={hrefForRange("90d", from, to)}>Last 90 Days</Link>
        </Button>
        <Button asChild variant={range === "all" ? "default" : "outline"} size="sm">
          <Link href={hrefForRange("all", from, to)}>All Time</Link>
        </Button>
      </div>

      <div className="flex flex-wrap gap-1 rounded-xl border border-border/60 bg-muted/30 p-1 print:hidden">
        {(["overview", "kyc", "fleet", "users"] as const).map((t) => (
          <Link key={t} href={hrefForTab(t, range, from, to)}
            className={`rounded-lg px-4 py-2 text-sm font-medium capitalize transition-colors ${
              tab === t ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
            }`}>
            {t === "overview" ? "Overview" : t === "kyc" ? "KYC" : t === "fleet" ? "Fleet" : "Users"}
          </Link>
        ))}
      </div>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Deposits</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{formatNaira(totalDeposits)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Invested</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{formatNaira(totalInvested)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Repayments Collected</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{formatNaira(totalRepayments)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Total Payout Credits</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{formatNaira(totalCredits)}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Active Pools</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{activePools}</p>
          </CardContent>
        </Card>
        <Card className="border-border/70">
          <CardHeader>
            <CardTitle className="text-sm font-medium text-muted-foreground">Funded Pools</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-semibold text-foreground">{fundedPools}</p>
          </CardContent>
        </Card>
      </section>

      <Card className="border-border/70">
        <CardHeader>
          <CardTitle className="text-base">Export Reports</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button asChild variant="outline">
            <Link href={`/api/admin/reports/export?type=deposits&${exportQuery.toString()}`}>
              <Download className="mr-2 h-4 w-4" />
              Export deposits CSV
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/api/admin/reports/export?type=investments&${exportQuery.toString()}`}>
              <Download className="mr-2 h-4 w-4" />
              Export investments CSV
            </Link>
          </Button>
          <Button asChild variant="outline">
            <Link href={`/api/admin/reports/export?type=repayments&${exportQuery.toString()}`}>
              <Download className="mr-2 h-4 w-4" />
              Export repayments CSV
            </Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}

