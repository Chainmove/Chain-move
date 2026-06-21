"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { CalendarDays, ChevronDown, PlusCircle } from "lucide-react"
import { formatEther } from "viem"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { DashboardHeader } from "@/components/dashboard/investor-overview/dashboard-header"
import { DashboardBanner } from "@/components/dashboard/investor-overview/dashboard-banner"
import { MetricsRow } from "@/components/dashboard/investor-overview/metrics-row"
import { PortfolioActivityCard } from "@/components/dashboard/investor-overview/portfolio-activity-card"
import { InvestorStellarActivityPanel } from "@/components/dashboard/investor-overview/stellar-activity-panel"
import { WalletsCard } from "@/components/dashboard/investor-overview/wallets-card"
import { Button } from "@/components/ui/button"
import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"
import { DashboardUnauthorized } from "@/components/dashboard/dashboard-unauthorized"
import { getUserDisplayName, useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { getPrivyFundingErrorMessage, startPrivyFunding } from "@/lib/auth/privy-funding"
import { useFundWallet, useWallets } from "@/lib/privy/react-auth"
import { formatNaira } from "@/lib/currency"
import { isMockStellar } from "@/lib/mock-stellar/mockConfig"
import { mockAccount } from "@/lib/mock-stellar/mockAccount"
import { mockActivity } from "@/lib/mock-stellar/mockActivity"
import { CURRENT_EMBEDDED_WALLET } from "@/lib/wallet/config"

type PoolPreview = {
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

function formatEthForUi(balanceEth: number | null) {
  const asset = CURRENT_EMBEDDED_WALLET.network.nativeAsset
  if (!Number.isFinite(balanceEth) || balanceEth === null) return `0 ${asset}`
  if (balanceEth < 0.01) return `0 ${asset}`
  if (balanceEth < 1) return `${balanceEth.toFixed(2)} ${asset}`
  return `${balanceEth.toFixed(1)} ${asset}`
}

async function resolveOnchainBalanceEth(address: string) {
  const rpcUrl = CURRENT_EMBEDDED_WALLET.network.rpcUrl
  if (!rpcUrl) return null
  const response = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_getBalance",
      params: [address, "latest"],
    }),
  })

  const payload = await response.json()
  const balanceHex = payload?.result
  if (typeof balanceHex !== "string") return null

  const parsed = Number.parseFloat(formatEther(BigInt(balanceHex)))
  if (!Number.isFinite(parsed)) return null
  return parsed
}

function isKycComplete(user: KycAwareAuthUser | null | undefined) {
  if (!user) return true

  if (typeof user.isKycVerified === "boolean") return user.isKycVerified
  if (typeof user.kycVerified === "boolean") return user.kycVerified

  const rawStatus = typeof user.kycStatus === "string" ? user.kycStatus.toLowerCase() : null
  if (!rawStatus) return true

  return ["approved", "approved_stage2", "verified", "complete", "completed"].includes(rawStatus)
}

function formatStartedDate(dateString: string) {
  const parsedDate = new Date(dateString)
  if (Number.isNaN(parsedDate.getTime())) return "Recently"
  return parsedDate.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

export default function InvestorOverviewPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user: authUser, loading: authLoading, refetch } = useAuth()
  const { wallets } = useWallets()
  const { fundWallet } = useFundWallet()

  const [openPools, setOpenPools] = useState<PoolPreview[]>([])
  const [isPoolsLoading, setIsPoolsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [onchainBalanceEth, setOnchainBalanceEth] = useState<number | null>(null)
  const [isDepositingCrypto, setIsDepositingCrypto] = useState(false)

  const embeddedWallet = useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === "privy" || wallet.walletClientType === "privy-v2"),
    [wallets],
  )
  const walletAddress = isMockStellar ? mockAccount.publicKey : (embeddedWallet?.address || authUser?.walletAddress || "")
  const isWalletConnected = Boolean(walletAddress)
  const investorKycComplete = isKycComplete((authUser as KycAwareAuthUser | null | undefined) ?? null)

  const investorName = getUserDisplayName(authUser, "Investor")

  const loadOpenPools = useCallback(async () => {
    setIsPoolsLoading(true)
    try {
      const response = await fetch("/api/pools?status=OPEN")
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || "Unable to load opportunities.")
      }
      setOpenPools((payload.pools || []).slice(0, 4))
    } catch (error) {
      toast({
        title: "Unable to load opportunities",
        description: error instanceof Error ? error.message : "Try again in a moment.",
        variant: "destructive",
      })
    } finally {
      setIsPoolsLoading(false)
    }
  }, [toast])

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
      const balance = await resolveOnchainBalanceEth(walletAddress)
      setOnchainBalanceEth(balance)
    } catch {
      setOnchainBalanceEth(null)
    }
  }, [walletAddress])

  const refreshOverview = async () => {
    setIsRefreshing(true)
    await Promise.all([loadOpenPools(), refetch?.(), refreshOnchainBalance()])
    setIsRefreshing(false)
  }

  useEffect(() => {
    void loadOpenPools()
  }, [loadOpenPools])

  useEffect(() => {
    void refreshOnchainBalance()
  }, [refreshOnchainBalance])

  const ethLabel = isMockStellar ? `${mockAccount.balance} XLM` : formatEthForUi(onchainBalanceEth)

  const metrics = useMemo(() => {
    const availableBalance = authUser?.availableBalance || 0
    const totalInvested = authUser?.totalInvested || 0
    const totalReturns = authUser?.totalReturns || 0
    const totalPortfolioValue = availableBalance + totalInvested + totalReturns
    const annualRoi = totalInvested > 0 ? (totalReturns / totalInvested) * 100 : 0

    return [
      {
        id: "portfolio-value",
        label: "Total Portfolio Value",
        value: formatNaira(totalPortfolioValue),
        accentValue: `+ ${ethLabel}`,
        hint: "Combined value of active vehicle investments.",
      },
      {
        id: "capital-invested",
        label: "Total Capital Invested",
        value: formatNaira(totalInvested),
        hint: "Total amount deployed into vehicle assets.",
      },
      {
        id: "returns-earned",
        label: "Total Returns Earned",
        value: formatNaira(totalReturns),
        accentValue: `+ ${ethLabel}`,
        hint: "Net income distributed to your wallets.",
      },
      {
        id: "annual-roi",
        label: "Annual ROI",
        value: `${formatNaira(totalReturns)} / ${annualRoi.toFixed(1)}%`,
        hint: "Calculated after operational and platform expenses.",
      },
    ]
  }, [authUser?.availableBalance, authUser?.totalInvested, authUser?.totalReturns, ethLabel])

  const activityItems = useMemo(() => {
    if (isMockStellar) {
      return mockActivity.map((activity) => ({
        id: activity.id,
        title: activity.type,
        startedLabel: `Date: ${formatStartedDate(activity.timestamp)}`,
        amountLabel: formatNaira(Number.parseFloat(activity.amount)),
        monthlyReturnsLabel: `Status: ${activity.status}`,
        progressLabel: "Completed",
        progressPercent: 100,
      }))
    }

    return openPools.slice(0, 2).map((pool) => {
      const principalAmount = pool.currentRaisedNgn > 0 ? pool.currentRaisedNgn : pool.targetAmountNgn
      const monthlyReturns = Math.round(principalAmount * 0.1)
      const progressMonths = Math.max(1, Math.round(Math.min(pool.progressRatio, 1) * 24))

      return {
        id: pool.id,
        title: pool.assetType === "KEKE" ? "Keke Napep" : "Shuttle Bus",
        startedLabel: `Started ${formatStartedDate(pool.createdAt)}`,
        amountLabel: formatNaira(principalAmount),
        monthlyReturnsLabel: `Estimated Monthly Returns:  ${formatNaira(monthlyReturns)}`,
        progressLabel: `${progressMonths}/24`,
        progressPercent: Math.min(Math.max(pool.progressRatio * 100, 6), 100),
      }
    })
  }, [openPools])

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

  if (authLoading) {
    return <DashboardRouteLoading title="Loading investor overview" description="Preparing wallet and opportunity data." />
  }

  if (!authUser || authUser.role !== "investor") {
    return <DashboardUnauthorized requiredRoles={["investor"]} currentRole={authUser?.role} />
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
      <main className="min-w-0 space-y-4 p-4 md:p-6">
        {bannerVariant ? (
          <DashboardBanner
            variant={bannerVariant}
            onAction={() =>
              router.push(bannerVariant === "connect-wallet" ? "/dashboard/investor/wallet" : "/dashboard/investor/kyc")
            }
          />
        ) : null}

        <section className="rounded-[10px] border border-border/70 bg-card px-4 py-4 md:px-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
            <div>
              <h2 className="text-xl font-semibold leading-tight text-foreground md:text-2xl">Portfolio Overview</h2>
              <p className="mt-2 text-sm text-muted-foreground">
                Monitor your mobility investments across fiat and crypto funding.
              </p>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Button variant="outline" className="h-10 w-full sm:w-auto" type="button">
                <CalendarDays className="mr-2 h-4 w-4" />
                Last 30 Days
                <ChevronDown className="ml-2 h-4 w-4" />
              </Button>
              <Button
                type="button"
                className="h-10 w-full bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 sm:w-auto"
                onClick={() => router.push("/dashboard/investor/wallet")}
              >
                <PlusCircle className="mr-2 h-4 w-4" />
                Fund Wallet
              </Button>
            </div>
          </div>
        </section>

        <MetricsRow metrics={metrics} />

        <section className="grid grid-cols-1 gap-4 xl:grid-cols-[1.55fr_1fr]">
          <PortfolioActivityCard
            activities={activityItems}
            isLoading={isPoolsLoading}
            isRefreshing={isRefreshing}
            onRefresh={refreshOverview}
            onViewAll={() => router.push("/dashboard/investor/investments")}
          />

          <WalletsCard
            fiatBalanceLabel={formatNaira(authUser.availableBalance || 0)}
            cryptoBalanceLabel={ethLabel}
            walletAddressLabel={walletAddress ? truncateAddress(walletAddress) : "not connected"}
            isRefreshing={isRefreshing}
            isDepositingCrypto={isDepositingCrypto}
            onRefresh={refreshOverview}
            onFundWallet={() => router.push("/dashboard/investor/wallet")}
            onDepositCrypto={handleDepositCrypto}
            onWithdrawToBank={() =>
              toast({
                title: "Withdrawals are managed in Wallet",
                description: "Open Wallet to continue bank withdrawal flow.",
              })
            }
          />
        </section>

        <InvestorStellarActivityPanel />
      </main>
    </DashboardShell>
  )
}
