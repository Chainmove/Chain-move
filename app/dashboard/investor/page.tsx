"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  CalendarDays,
  ChevronDown,
  PlusCircle,
  TrendingUp,
  Wallet,
  Percent,
  CheckCircle2,
  Clock,
  Bus,
  Activity,
  AlertCircle,
  RefreshCw,
  Search,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronRight,
  Info,
  DollarSign
} from "lucide-react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { DashboardHeader } from "@/components/dashboard/investor-overview/dashboard-header"
import { DashboardBanner } from "@/components/dashboard/investor-overview/dashboard-banner"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Skeleton } from "@/components/ui/skeleton"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"
import { getUserDisplayName, useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { getPrivyFundingErrorMessage, startPrivyFunding } from "@/lib/auth/privy-funding"
import { useFundWallet, useWallets } from "@/lib/privy/react-auth"
import { formatNaira, formatPercent } from "@/lib/currency"
import { isMockStellar } from "@/lib/mock-stellar/mockConfig"
import { mockAccount } from "@/lib/mock-stellar/mockAccount"
import { CURRENT_EMBEDDED_WALLET } from "@/lib/wallet/config"
import { InvestorStellarActivityPanel } from "@/components/dashboard/investor-overview/stellar-activity-panel"

// Recharts imports for comparison chart
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer
} from "recharts"
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart"

type PoolContractPreview = {
  id: string
  vehicleDisplayName: string
  principal: number
  totalPayable: number
  totalPaid: number
  status: string
  startDate: string
  progressPercent: number
}

type ActivePosition = {
  id: string
  poolId: string
  assetType: "SHUTTLE" | "KEKE"
  status: "OPEN" | "FUNDED" | "CLOSED"
  targetAmountNgn: number
  currentRaisedNgn: number
  userInvestedNgn: number
  userOwnershipBps: number
  expectedReturnsLifetime: number
  expectedReturnsToDate: number
  actualReturnsToDate: number
  repaymentProgressPercent: number
  contractsCount: number
  contracts: PoolContractPreview[]
  createdAt: string
}

type LegacyPosition = {
  id: string
  vehicleId: string
  vehicleName: string
  assetType: string
  status: string
  amount: number
  monthlyReturn: number
  expectedReturnsLifetime: number
  expectedReturnsToDate: number
  actualReturnsToDate: number
  repaymentProgressPercent: number
  startDate: string
}

type DashboardTransaction = {
  id: string
  type: string
  amount: number
  currency: string
  method: string
  status: string
  description: string
  timestamp: string
}

type DashboardData = {
  totals: {
    totalInvested: number
    availableBalance: number
    totalReturns: number
    totalExpectedToDate: number
    totalExpectedLifetime: number
    totalPortfolioValue: number
    averageRoi: number
  }
  activePositions: ActivePosition[]
  legacyPositions: LegacyPosition[]
  transactions: DashboardTransaction[]
  emptyState: boolean
}

type OpenPoolPreview = {
  id: string
  assetType: "SHUTTLE" | "KEKE"
  targetAmountNgn: number
  currentRaisedNgn: number
  investorCount: number
  status: "OPEN" | "FUNDED" | "CLOSED"
  progressRatio: number
  createdAt: string
}

type KycAwareAuthUser = {
  kycStatus?: string
  isKycVerified?: boolean
  kycVerified?: boolean
}

function truncateAddress(address: string) {
  if (address.length < 10) return address
  return `${address.slice(0, 4)}...${address.slice(-4)}`
}

function isKycComplete(user: KycAwareAuthUser | null | undefined) {
  if (!user) return true
  if (typeof user.isKycVerified === "boolean") return user.isKycVerified
  if (typeof user.kycVerified === "boolean") return user.kycVerified
  const rawStatus = typeof user.kycStatus === "string" ? user.kycStatus.toLowerCase() : null
  if (!rawStatus) return true
  return ["approved", "approved_stage2", "verified", "complete", "completed"].includes(rawStatus)
}

export default function InvestorDashboardPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user: authUser, loading: authLoading, refetch: refetchAuth } = useAuth()
  const { wallets } = useWallets()
  const { fundWallet } = useFundWallet()

  const [dashboardData, setDashboardData] = useState<DashboardData | null>(null)
  const [openPools, setOpenPools] = useState<OpenPoolPreview[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [onchainBalanceEth, setOnchainBalanceEth] = useState<number | null>(null)
  const [isDepositingCrypto, setIsDepositingCrypto] = useState(false)
  const [txFilter, setTxFilter] = useState<string>("all")

  const embeddedWallet = useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === "privy" || wallet.walletClientType === "privy-v2"),
    [wallets],
  )
  const walletAddress = isMockStellar ? mockAccount.publicKey : (embeddedWallet?.address || authUser?.walletAddress || "")
  const isWalletConnected = Boolean(walletAddress)
  const investorKycComplete = isKycComplete((authUser as KycAwareAuthUser | null | undefined) ?? null)
  const investorName = getUserDisplayName(authUser, "Investor")

  const fetchDashboardData = useCallback(async (silent = false) => {
    if (!silent) setIsLoading(true)
    setError(null)
    try {
      const response = await fetch("/api/investor/dashboard")
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || "Failed to load dashboard data.")
      }
      setDashboardData(payload)
    } catch (err) {
      setError(err instanceof Error ? err.message : "An unexpected error occurred.")
      toast({
        title: "Unable to load dashboard",
        description: err instanceof Error ? err.message : "Try again in a moment.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
    }
  }, [toast])

  const fetchOpenPools = useCallback(async () => {
    try {
      const response = await fetch("/api/pools?status=OPEN")
      const payload = await response.json()
      if (response.ok && payload.pools) {
        setOpenPools(payload.pools.slice(0, 3))
      }
    } catch (err) {
      console.error("Failed to load open pools:", err)
    }
  }, [])

  const refreshOnchainBalance = useCallback(async () => {
    if (isMockStellar) {
      setOnchainBalanceEth(Number.parseFloat(mockAccount.balance))
      return
    }

    if (!walletAddress) {
      setOnchainBalanceEth(null)
      return
    }

    try {
      const rpcUrl = CURRENT_EMBEDDED_WALLET.network.rpcUrl
      if (!rpcUrl) return
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "eth_getBalance",
          params: [walletAddress, "latest"],
        }),
      })
      const payload = await response.json()
      const balanceHex = payload?.result
      if (typeof balanceHex === "string") {
        const parsed = Number.parseFloat(window.BigInt ? String(Number(balanceHex) / 1e18) : "0")
        setOnchainBalanceEth(parsed)
      }
    } catch {
      setOnchainBalanceEth(null)
    }
  }, [walletAddress])

  const handleRefresh = async () => {
    setIsRefreshing(true)
    await Promise.all([
      fetchDashboardData(true),
      fetchOpenPools(),
      refetchAuth?.(),
      refreshOnchainBalance()
    ])
    setIsRefreshing(false)
    toast({
      title: "Data refreshed",
      description: "Your investment portfolio has been updated.",
    })
  }

  useEffect(() => {
    void fetchDashboardData()
    void fetchOpenPools()
  }, [fetchDashboardData, fetchOpenPools])

  useEffect(() => {
    void refreshOnchainBalance()
  }, [refreshOnchainBalance])

  const ethLabel = isMockStellar ? `${mockAccount.balance} XLM` : onchainBalanceEth !== null ? `${onchainBalanceEth.toFixed(2)} ETH` : "0 ETH"
  const walletChipLabel = isWalletConnected ? `${truncateAddress(walletAddress)} (${ethLabel})` : null
  const bannerVariant = !isWalletConnected ? "connect-wallet" : !investorKycComplete ? "kyc" : null

  const handleDepositCrypto = async () => {
    if (isMockStellar) {
      toast({
        title: "Mock Demo",
        description: "Crypto deposit flow is simulated in demo mode.",
      })
      return
    }

    if (!walletAddress) {
      router.push("/dashboard/investor/wallet")
      return
    }

    setIsDepositingCrypto(true)
    try {
      await startPrivyFunding({
        walletAddress,
        embeddedWallet,
        fundWallet,
      })
      toast({
        title: "Deposit flow opened",
        description: "Complete the Privy flow to top up your crypto wallet.",
      })
    } catch (error) {
      toast({
        title: "Unable to start deposit",
        description: getPrivyFundingErrorMessage(error),
        variant: "destructive",
      })
    } finally {
      setIsDepositingCrypto(false)
      await refreshOnchainBalance()
    }
  }

  // Chart data preparing expected vs actual returns
  const returnsChartData = useMemo(() => {
    if (!dashboardData) return []
    const data: { name: string; expected: number; actual: number }[] = []

    dashboardData.activePositions.forEach((pos) => {
      data.push({
        name: `${pos.assetType === "SHUTTLE" ? "Shuttle" : "Keke"} Pool`,
        expected: Math.round(pos.expectedReturnsToDate),
        actual: Math.round(pos.actualReturnsToDate)
      })
    })

    dashboardData.legacyPositions.forEach((pos) => {
      data.push({
        name: pos.vehicleName,
        expected: Math.round(pos.expectedReturnsToDate),
        actual: Math.round(pos.actualReturnsToDate)
      })
    })

    return data
  }, [dashboardData])

  // Filtered transactions list
  const filteredTransactions = useMemo(() => {
    if (!dashboardData) return []
    return dashboardData.transactions.filter((tx) => {
      if (txFilter === "all") return true
      if (txFilter === "investment") return tx.type.includes("investment")
      if (txFilter === "return") return tx.type === "return"
      if (txFilter === "deposit") return tx.type === "deposit" || tx.type === "wallet_funding"
      if (txFilter === "withdrawal") return tx.type === "withdrawal"
      return true
    })
  }, [dashboardData, txFilter])

  if (authLoading || (isLoading && !dashboardData)) {
    return <DashboardRouteLoading title="Loading portfolio dashboard" description="Analyzing investment metrics, returns, and pool performance." />
  }

  if (!authUser || authUser.role !== "investor") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <Card className="w-full max-w-md">
          <CardHeader>
            <CardTitle>Access denied</CardTitle>
            <CardDescription>You need an investor account to access this dashboard.</CardDescription>
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
    <DashboardShell
      role="investor"
      sidebarWidth="compact"
      header={
        <DashboardHeader
          welcomeName={investorName}
          walletChipLabel={walletChipLabel}
          onWalletChipClick={() => router.push("/dashboard/investor/wallet")}
        />
      }
    >
      <main className="min-w-0 space-y-5 p-4 md:p-6">
        {bannerVariant ? (
          <DashboardBanner
            variant={bannerVariant}
            onAction={() =>
              router.push(bannerVariant === "connect-wallet" ? "/dashboard/investor/wallet" : "/dashboard/investor/kyc")
            }
          />
        ) : null}

        {/* Dashboard Title & Actions */}
        <section className="flex flex-col gap-4 rounded-xl border border-border/70 bg-card p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Investor Dashboard</h1>
            <p className="text-xs text-muted-foreground mt-1">
              Real-time portfolio metrics, vehicle pool performance, and earnings tracking.
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRefresh}
              disabled={isRefreshing}
              className="h-9"
            >
              <RefreshCw className={`h-4 w-4 mr-2 ${isRefreshing ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button
              size="sm"
              className="h-9 bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400"
              onClick={() => router.push("/dashboard/investor/opportunities")}
            >
              <PlusCircle className="mr-2 h-4 w-4" />
              New Investment
            </Button>
          </div>
        </section>

        {error ? (
          <Card className="border-destructive/40 bg-destructive/5 text-destructive p-6">
            <div className="flex items-center gap-3">
              <AlertCircle className="h-6 w-6" />
              <div>
                <h3 className="font-semibold text-base">Dashboard error</h3>
                <p className="text-sm mt-1">{error}</p>
              </div>
            </div>
            <Button className="mt-4" variant="outline" onClick={() => fetchDashboardData()}>
              Retry loading
            </Button>
          </Card>
        ) : dashboardData?.emptyState ? (
          /* EMPTY STATE FOR NEW INVESTORS */
          <div className="space-y-6">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Total Portfolio Value</CardDescription>
                  <CardTitle className="text-xl">{formatNaira(0)}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Capital Invested</CardDescription>
                  <CardTitle className="text-xl">{formatNaira(0)}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Wallet Balance</CardDescription>
                  <CardTitle className="text-xl">{formatNaira(authUser.availableBalance || 0)}</CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs">Total Returns Earned</CardDescription>
                  <CardTitle className="text-xl">{formatNaira(0)}</CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card className="border-dashed border-2 py-8 text-center max-w-2xl mx-auto">
              <CardHeader>
                <Wallet className="mx-auto h-12 w-12 text-muted-foreground stroke-1" />
                <CardTitle className="text-xl mt-4">Welcome to ChainMove Investments</CardTitle>
                <CardDescription className="text-sm max-w-md mx-auto">
                  You haven't invested in any vehicle pools yet. Start earning up to 24% annual returns on asset-backed logistics vehicles.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col sm:flex-row gap-3 justify-center mt-2">
                <Button
                  onClick={() => router.push("/dashboard/investor/wallet")}
                  className="bg-amber-600 hover:bg-amber-700 text-white"
                >
                  Fund Your Wallet
                </Button>
                <Button
                  variant="outline"
                  onClick={() => router.push("/dashboard/investor/opportunities")}
                >
                  Explore Pool Opportunities
                </Button>
              </CardContent>
            </Card>

            {openPools.length > 0 && (
              <section className="space-y-3">
                <h3 className="font-semibold text-lg">Featured Opportunities</h3>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                  {openPools.map((pool) => {
                    const progress = pool.progressRatio * 100
                    return (
                      <Card key={pool.id} className="hover:border-amber-500/50 transition-all flex flex-col justify-between">
                        <CardHeader>
                          <div className="flex items-center justify-between">
                            <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-400">
                              {pool.assetType} POOL
                            </Badge>
                            <Badge variant="outline">OPEN</Badge>
                          </div>
                          <CardTitle className="text-lg mt-3">
                            {pool.assetType === "KEKE" ? "Keke Napep Fleet Pool" : "Shuttle Bus Transit Pool"}
                          </CardTitle>
                          <CardDescription className="text-xs">
                            Targeting {formatNaira(pool.targetAmountNgn)}
                          </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4 pt-0">
                          <div className="space-y-1">
                            <div className="flex justify-between text-xs text-muted-foreground">
                              <span>Raised: {formatNaira(pool.currentRaisedNgn)}</span>
                              <span>{progress.toFixed(0)}%</span>
                            </div>
                            <Progress value={progress} className="h-1.5" />
                          </div>
                          <Button
                            className="w-full text-xs h-9 bg-amber-600 hover:bg-amber-700 text-white"
                            onClick={() => router.push(`/dashboard/investor/opportunities`)}
                          >
                            Invest Units
                            <ChevronRight className="h-3.5 w-3.5 ml-1" />
                          </Button>
                        </CardContent>
                      </Card>
                    )
                  })}
                </div>
              </section>
            )}
          </div>
        ) : (
          /* POPULATED DASHBOARD STATE */
          <div className="space-y-5">
            {/* Core Metrics Row */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    Total Portfolio Value
                  </CardDescription>
                  <CardTitle className="text-2xl font-bold">
                    {formatNaira(dashboardData?.totals.totalPortfolioValue)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground pt-0">
                  Combined wallet balance, active capital, and earned returns.
                </CardContent>
              </Card>

              <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
                    <Bus className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    Capital Invested
                  </CardDescription>
                  <CardTitle className="text-2xl font-bold">
                    {formatNaira(dashboardData?.totals.totalInvested)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground pt-0">
                  Total principal funds active across vehicle pools.
                </CardContent>
              </Card>

              <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
                    <Wallet className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
                    Available Balance
                  </CardDescription>
                  <CardTitle className="text-2xl font-bold">
                    {formatNaira(dashboardData?.totals.availableBalance)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground pt-0">
                  Fiat wallet funds available for withdrawal or new investments.
                </CardContent>
              </Card>

              <Card className="hover:shadow-md transition-shadow">
                <CardHeader className="pb-2">
                  <CardDescription className="text-xs font-medium uppercase tracking-wider flex items-center gap-1.5">
                    <TrendingUp className="h-3.5 w-3.5 text-emerald-600" />
                    Total Returns Earned
                  </CardDescription>
                  <CardTitle className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                    {formatNaira(dashboardData?.totals.totalReturns)}
                  </CardTitle>
                </CardHeader>
                <CardContent className="text-xs text-muted-foreground pt-0">
                  Payouts distributed from driver contracts. Avg ROI: {formatPercent(dashboardData?.totals.averageRoi)}
                </CardContent>
              </Card>
            </div>

            {/* Performance charts section */}
            <section className="grid grid-cols-1 gap-5 lg:grid-cols-[1.6fr_1fr]">
              {/* Expected vs Actual Returns comparison */}
              <Card className="col-span-1">
                <CardHeader>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <TrendingUp className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    Expected vs Actual Returns
                  </CardTitle>
                  <CardDescription>
                    Compare expected payout returns to-date with actual returns paid to your wallet.
                  </CardDescription>
                </CardHeader>
                <CardContent className="pt-2">
                  {returnsChartData.length > 0 ? (
                    <div className="h-[280px] w-full">
                      <ChartContainer
                        config={{
                          expected: {
                            label: "Expected returns to-date",
                            color: "hsl(var(--muted-foreground))",
                          },
                          actual: {
                            label: "Actual returns distributed",
                            color: "#10b981",
                          },
                        }}
                      >
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={returnsChartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="name" stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} />
                            <YAxis stroke="hsl(var(--muted-foreground))" fontSize={11} tickLine={false} axisLine={false} tickFormatter={(val) => `₦${val.toLocaleString()}`} />
                            <ChartTooltip content={<ChartTooltipContent />} />
                            <Bar dataKey="expected" fill="#94a3b8" radius={[4, 4, 0, 0]} name="Expected returns to-date" />
                            <Bar dataKey="actual" fill="#10b981" radius={[4, 4, 0, 0]} name="Actual returns distributed" />
                          </BarChart>
                        </ResponsiveContainer>
                      </ChartContainer>
                    </div>
                  ) : (
                    <div className="h-[280px] flex items-center justify-center text-muted-foreground text-sm border border-dashed rounded-xl">
                      Waiting for active vehicle payouts to populate returns tracking.
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Connected Wallets summary */}
              <div className="space-y-4">
                <Card className="h-full flex flex-col justify-between">
                  <CardHeader className="pb-3">
                    <CardTitle className="text-lg flex items-center justify-between">
                      <span>Wallets Overview</span>
                      <Wallet className="h-5 w-5 text-muted-foreground stroke-1" />
                    </CardTitle>
                    <CardDescription>Manage your balances and withdrawal routes</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg border bg-muted/40 p-4">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Internal Fiat Wallet</p>
                      <p className="text-2xl font-bold mt-1 text-foreground">
                        {formatNaira(dashboardData?.totals.availableBalance)}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1.5 flex items-center gap-1">
                        <Info className="h-3 w-3 text-amber-500" />
                        Available for buying new pool shares.
                      </p>
                      <div className="mt-3 grid grid-cols-2 gap-2">
                        <Button
                          size="sm"
                          className="h-8 text-xs bg-amber-600 hover:bg-amber-700 text-white"
                          onClick={() => router.push("/dashboard/investor/wallet")}
                        >
                          Fund Fiat
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs"
                          onClick={() =>
                            toast({
                              title: "Withdrawal flow",
                              description: "Please navigate to the Wallet tab to set up banking details.",
                            })
                          }
                        >
                          Withdraw
                        </Button>
                      </div>
                    </div>

                    <div className="rounded-lg border bg-muted/40 p-4">
                      <p className="text-xs text-muted-foreground uppercase tracking-wide">Crypto Stellar Wallet</p>
                      <p className="text-2xl font-bold mt-1 text-foreground">{ethLabel}</p>
                      <p className="text-[11px] font-mono text-muted-foreground mt-1.5 truncate">
                        Addr: {walletAddress ? truncateAddress(walletAddress) : "Not connected"}
                      </p>
                      <div className="mt-3">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full h-8 text-xs"
                          onClick={handleDepositCrypto}
                          disabled={isDepositingCrypto}
                        >
                          {isDepositingCrypto ? "Processing..." : "Deposit Crypto Balance"}
                        </Button>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </section>

            {/* Active Pool positions (Pool-by-pool cards) */}
            <section className="space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Active Pool Positions</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Your ownership progress, vehicle metrics, and contract payment details.
                  </p>
                </div>
                <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-400">
                  {dashboardData?.activePositions.length || 0} Positions Active
                </Badge>
              </div>

              <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
                {dashboardData?.activePositions.map((pos) => {
                  return (
                    <Card key={pos.id} className="flex flex-col justify-between hover:border-border/100 transition-colors">
                      <CardHeader className="pb-3 border-b">
                        <div className="flex items-center justify-between">
                          <Badge variant="secondary" className="bg-amber-500/10 text-amber-700 dark:text-amber-400">
                            {pos.assetType} POOL
                          </Badge>
                          <Badge variant={pos.status === "OPEN" ? "outline" : "default"}>
                            {pos.status}
                          </Badge>
                        </div>
                        <CardTitle className="text-base mt-2 flex items-center justify-between">
                          <span>{pos.assetType === "KEKE" ? "Keke Napep Transit Pool" : "Shuttle Bus Transit Pool"}</span>
                          <span className="text-xs font-mono text-muted-foreground">ID: {pos.poolId.slice(-6)}</span>
                        </CardTitle>
                      </CardHeader>

                      <CardContent className="space-y-4 py-4">
                        {/* Position Financials */}
                        <div className="grid grid-cols-3 gap-2 text-center bg-muted/30 p-2.5 rounded-lg border">
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">Invested</p>
                            <p className="text-sm font-bold text-foreground mt-0.5">
                              {formatNaira(pos.userInvestedNgn)}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">Share %</p>
                            <p className="text-sm font-bold text-foreground mt-0.5">
                              {(pos.userOwnershipBps / 100).toFixed(2)}%
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] text-muted-foreground uppercase">Returns Earned</p>
                            <p className="text-sm font-bold text-emerald-600 dark:text-emerald-400 mt-0.5">
                              {formatNaira(pos.actualReturnsToDate)}
                            </p>
                          </div>
                        </div>

                        {/* Return Progress Estimates */}
                        <div className="space-y-2">
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground flex items-center gap-1">
                              Expected lifetime returns:
                            </span>
                            <span className="font-semibold text-foreground">{formatNaira(pos.expectedReturnsLifetime)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-muted-foreground">Expected returns to-date:</span>
                            <span className="font-semibold text-foreground">{formatNaira(pos.expectedReturnsToDate)}</span>
                          </div>
                        </div>

                        {/* Repayment Progress per Pool */}
                        <div className="space-y-1.5">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground font-medium">Repayment Progress (Pool-wide)</span>
                            <span className="font-semibold">{pos.repaymentProgressPercent.toFixed(1)}%</span>
                          </div>
                          <Progress value={pos.repaymentProgressPercent} className="h-2" />
                        </div>

                        {/* Individual vehicle contracts */}
                        <div className="space-y-2 pt-2">
                          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1">
                            <Bus className="h-3 w-3" />
                            Financed Vehicles ({pos.contractsCount})
                          </h4>
                          {pos.contractsCount > 0 ? (
                            <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                              {pos.contracts.map((contract) => (
                                <div key={contract.id} className="text-xs border p-2 rounded-md bg-background space-y-1.5">
                                  <div className="flex justify-between font-medium">
                                    <span className="text-foreground">{contract.vehicleDisplayName}</span>
                                    <Badge variant={contract.status === "ACTIVE" ? "secondary" : "outline"} className="text-[10px] h-4 py-0">
                                      {contract.status}
                                    </Badge>
                                  </div>
                                  <div className="flex justify-between text-[11px] text-muted-foreground">
                                    <span>Principal: {formatNaira(contract.principal)}</span>
                                    <span>Paid: {formatNaira(contract.totalPaid)}</span>
                                  </div>
                                  <div className="space-y-1">
                                    <div className="flex justify-between text-[10px] text-muted-foreground">
                                      <span>Repayment progress</span>
                                      <span>{contract.progressPercent.toFixed(0)}%</span>
                                    </div>
                                    <Progress value={contract.progressPercent} className="h-1 bg-muted" />
                                  </div>
                                </div>
                              ))}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground italic bg-muted/40 p-2 rounded border border-dashed">
                              No driver contracts active for this pool. Waiting for vehicle financing placement.
                            </p>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            </section>

            {/* Recent transactions (filters and payouts) */}
            <section className="space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="text-lg font-bold text-foreground">Transaction History</h2>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Filter and audit your investment transactions, returns, and wallet flows.
                  </p>
                </div>

                <div className="flex gap-2">
                  <Select value={txFilter} onValueChange={setTxFilter}>
                    <SelectTrigger className="w-[180px] h-9">
                      <SelectValue placeholder="Filter by type" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All transactions</SelectItem>
                      <SelectItem value="investment">Pool Investments</SelectItem>
                      <SelectItem value="return">Contract Payouts</SelectItem>
                      <SelectItem value="deposit">Deposits</SelectItem>
                      <SelectItem value="withdrawal">Withdrawals</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <Card>
                <CardContent className="p-0">
                  {filteredTransactions.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground text-sm">
                      No transactions match the selected filter.
                    </div>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-border">
                        <thead className="bg-muted/30">
                          <tr className="text-left text-[11px] uppercase tracking-wider font-semibold text-muted-foreground">
                            <th className="px-4 py-3">Type</th>
                            <th className="px-4 py-3">Description</th>
                            <th className="px-4 py-3">Date</th>
                            <th className="px-4 py-3 text-right">Amount</th>
                            <th className="px-4 py-3 text-center">Status</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border bg-card text-xs">
                          {filteredTransactions.map((tx) => {
                            const isCredit = tx.type === "return" || tx.type === "deposit" || tx.type === "wallet_funding"
                            return (
                              <tr key={tx.id} className="hover:bg-muted/10">
                                <td className="px-4 py-3 font-medium">
                                  <span className="flex items-center gap-1.5">
                                    {isCredit ? (
                                      <ArrowDownLeft className="h-3.5 w-3.5 text-emerald-600" />
                                    ) : (
                                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                                    )}
                                    <span className="capitalize">{tx.type.replace("_", " ")}</span>
                                  </span>
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">
                                  {tx.description}
                                </td>
                                <td className="px-4 py-3 text-muted-foreground">
                                  {new Date(tx.timestamp).toLocaleDateString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    year: "numeric"
                                  })}
                                </td>
                                <td className={`px-4 py-3 text-right font-semibold ${isCredit ? "text-emerald-600 dark:text-emerald-400" : "text-foreground"}`}>
                                  {isCredit ? "+" : "-"}{formatNaira(tx.amount)}
                                </td>
                                <td className="px-4 py-3 text-center">
                                  <Badge
                                    variant={tx.status.toLowerCase() === "completed" ? "secondary" : "outline"}
                                    className={`text-[10px] h-5 px-1.5 ${
                                      tx.status.toLowerCase() === "completed"
                                        ? "bg-green-500/10 text-green-700 dark:text-green-400 border-none"
                                        : "bg-amber-500/10 text-amber-700 dark:text-amber-400 border-none"
                                    }`}
                                  >
                                    {tx.status}
                                  </Badge>
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </section>

            {/* Stellar link dashboard element */}
            <InvestorStellarActivityPanel />
          </div>
        )}
      </main>
    </DashboardShell>
  )
}
