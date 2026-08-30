"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Download, RefreshCw, Search, TrendingUp } from "lucide-react"
import { Sidebar } from "@/components/dashboard/sidebar"
import { Header } from "@/components/dashboard/header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { usePlatform } from "@/contexts/platform-context"
import { formatNaira, formatPercent } from "@/lib/currency"
import { getUserDisplayName, useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"

/** Canonical money envelope from the API. See docs/api-conventions.md. */
type Money = {
  currency: string
  amountMinor: number
  amountMajor: number
}

type PortfolioInvestment = {
  id: string
  vehicleId: string | null
  amount: Money
  monthlyReturn: Money
  status?: string
  date: string | null
  // Not served by /api/investments; retained so the progress and ROI panels
  // keep their existing zero-state rendering.
  expectedROI?: number
  paymentsReceived?: number
  totalPayments?: number
}

export default function MyInvestmentsPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { state, dispatch } = usePlatform()
  const { user: authUser, loading: authLoading } = useAuth()

  const [investments, setInvestments] = useState<PortfolioInvestment[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [searchTerm, setSearchTerm] = useState("")
  const [statusFilter, setStatusFilter] = useState("all")

  const investorId = authUser?.id || ""
  const investorName = getUserDisplayName(authUser, "Investor")

  const fetchInvestments = useCallback(async () => {
    if (!investorId) return

    setLoading(true)
    setError(null)

    try {
      const response = await fetch("/api/investments")
      if (!response.ok) {
        throw new Error("Unable to load investments")
      }

      const payload = await response.json()
      const nextInvestments = payload.investments || []

      setInvestments(nextInvestments)
      dispatch({ type: "SET_INVESTMENTS", payload: nextInvestments })
    } catch (fetchError) {
      setError(fetchError instanceof Error ? fetchError.message : "Unable to load investments")
    } finally {
      setLoading(false)
    }
  }, [investorId, dispatch])

  useEffect(() => {
    if (investorId) {
      fetchInvestments()
    }
  }, [fetchInvestments, investorId])

  const vehicleMap = useMemo(() => {
    const nextMap = new Map<string, string>()
    state.vehicles.forEach((vehicle) => {
      nextMap.set(vehicle._id, vehicle.name)
    })
    return nextMap
  }, [state.vehicles])

  const filteredInvestments = useMemo(() => {
    return investments.filter((investment) => {
      const vehicleName = vehicleMap.get(investment.vehicleId || "") || "Unknown Vehicle"
      const normalizedStatus = (investment.status || "Active").toLowerCase()

      const matchesSearch = vehicleName.toLowerCase().includes(searchTerm.toLowerCase())
      const matchesStatus = statusFilter === "all" || normalizedStatus === statusFilter

      return matchesSearch && matchesStatus
    })
  }, [investments, vehicleMap, searchTerm, statusFilter])

  const portfolioStats = useMemo(() => {
    const totalInvested = filteredInvestments.reduce((sum, item) => sum + item.amount.amountMajor, 0)
    const totalMonthlyReturn = filteredInvestments.reduce((sum, item) => sum + item.monthlyReturn.amountMajor, 0)
    const averageROI =
      filteredInvestments.length > 0
        ? filteredInvestments.reduce((sum, item) => sum + (item.expectedROI || 0), 0) / filteredInvestments.length
        : 0

    return {
      totalInvested,
      totalMonthlyReturn,
      averageROI,
    }
  }, [filteredInvestments])

  const exportCsv = () => {
    if (filteredInvestments.length === 0) {
      toast({
        title: "No data to export",
        description: "Adjust your filters or add investments before exporting.",
      })
      return
    }

    const rows = [
      ["Vehicle", "Status", "Amount (NGN)", "Monthly Return (NGN)", "Start Date"],
      ...filteredInvestments.map((item) => [
        vehicleMap.get(item.vehicleId || "") || "Unknown Vehicle",
        item.status || "Active",
        item.amount.amountMajor,
        item.monthlyReturn.amountMajor,
        new Date(item.date || Date.now()).toLocaleDateString(),
      ]),
    ]

    const csv = rows.map((row) => row.join(",")).join("\n")
    const blob = new Blob([csv], { type: "text/csv" })
    const url = window.URL.createObjectURL(blob)
    const anchor = document.createElement("a")
    anchor.href = url
    anchor.download = "investor-portfolio.csv"
    anchor.click()
    window.URL.revokeObjectURL(url)

    toast({
      title: "Export complete",
      description: "Your investments were exported successfully.",
    })
  }

  if (authLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <p className="text-muted-foreground">Loading your portfolio...</p>
      </div>
    )
  }

  if (!authUser || authUser.role !== "investor") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>You need an investor account to view this page.</CardDescription>
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
    <div className="min-h-screen bg-background">
      <Sidebar role="investor" />

      <div className="min-w-0 md:ml-64 lg:ml-72">
        <Header userName={investorName} userStatus="Verified Investor" />

        <main className="min-w-0 space-y-6 p-4 sm:p-6">
          <section className="rounded-xl border bg-card p-4 sm:p-6">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h1 className="text-2xl font-semibold">My Investments</h1>
                <p className="text-muted-foreground mt-1">
                  Review your portfolio health, payment progress, and monthly returns.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="outline" onClick={fetchInvestments} disabled={loading}>
                  <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button variant="outline" onClick={exportCsv}>
                  <Download className="h-4 w-4 mr-2" />
                  Export CSV
                </Button>
              </div>
            </div>
          </section>

          <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Invested</CardDescription>
                <CardTitle>{formatNaira(portfolioStats.totalInvested)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Monthly Return</CardDescription>
                <CardTitle>{formatNaira(portfolioStats.totalMonthlyReturn)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Average ROI</CardDescription>
                <CardTitle>{formatPercent(portfolioStats.averageROI)}</CardTitle>
              </CardHeader>
            </Card>
          </section>

          <section>
            <Card>
              <CardHeader>
                <CardTitle>Portfolio List</CardTitle>
                <CardDescription>Filter by status and search by vehicle name.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <div className="relative md:col-span-2">
                    <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
                    <Input
                      value={searchTerm}
                      onChange={(event) => setSearchTerm(event.target.value)}
                      placeholder="Search by vehicle name"
                      className="pl-9"
                    />
                  </div>

                  <Select value={statusFilter} onValueChange={setStatusFilter}>
                    <SelectTrigger>
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All statuses</SelectItem>
                      <SelectItem value="active">Active</SelectItem>
                      <SelectItem value="completed">Completed</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {error ? (
                  <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-4">
                    <p className="font-medium text-destructive">Failed to load investments</p>
                    <p className="text-sm text-muted-foreground mt-1">{error}</p>
                  </div>
                ) : loading ? (
                  <div className="py-10 text-center text-muted-foreground">Loading investments...</div>
                ) : filteredInvestments.length === 0 ? (
                  <div className="py-10 text-center">
                    <TrendingUp className="mx-auto h-10 w-10 text-muted-foreground" />
                    <h3 className="mt-3 font-semibold">No matching investments</h3>
                    <p className="text-sm text-muted-foreground mt-1">
                      Try another filter or discover new opportunities from your dashboard.
                    </p>
                    <Button className="mt-4" onClick={() => router.push("/dashboard/investor")}>Go to dashboard</Button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {filteredInvestments.map((investment) => {
                      const vehicleName = vehicleMap.get(investment.vehicleId || "") || "Unknown Vehicle"
                      const currentStatus = investment.status || "Active"
                      const progress =
                        (investment.totalPayments || 0) > 0
                          ? ((investment.paymentsReceived || 0) / (investment.totalPayments || 1)) * 100
                          : 0

                      return (
                        <article key={investment.id} className="rounded-xl border p-4">
                          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <h3 className="font-semibold">{vehicleName}</h3>
                              <p className="text-sm text-muted-foreground">
                                Started {new Date(investment.date || Date.now()).toLocaleDateString()}
                              </p>
                            </div>

                            <div className="text-left sm:text-right">
                              <Badge variant="secondary">{currentStatus}</Badge>
                              <p className="mt-2 font-semibold">{formatNaira(investment.amount.amountMajor)}</p>
                              <p className="text-xs text-green-600 dark:text-emerald-400">
                                +{formatNaira(investment.monthlyReturn.amountMajor)} / month
                              </p>
                            </div>
                          </div>

                          <div className="mt-3 space-y-2">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>Payout progress</span>
                              <span>
                                {investment.paymentsReceived || 0}/{investment.totalPayments || 0}
                              </span>
                            </div>
                            <Progress value={progress} className="h-2" />
                          </div>
                        </article>
                      )
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </section>
        </main>
      </div>
    </div>
  )
}
