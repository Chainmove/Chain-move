"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowRight, ChevronRight, Layers, Loader2, Plus, Users, Wallet } from "lucide-react"

import { DashboardShell } from "@/components/dashboard/dashboard-shell"
import { Header } from "@/components/dashboard/header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Textarea } from "@/components/ui/textarea"
import { DashboardRouteLoading } from "@/components/dashboard/dashboard-route-loading"
import { getUserDisplayName, useAuth } from "@/hooks/use-auth"
import { useToast } from "@/hooks/use-toast"
import { formatNaira, formatPercent } from "@/lib/currency"

type AssetType = "SHUTTLE" | "KEKE"

const DEFAULT_TARGETS: Record<AssetType, number> = {
  SHUTTLE: 4_600_000,
  KEKE: 3_500_000,
}

/** Canonical money envelope from the API. See docs/api-conventions.md. */
interface Money {
  currency: string
  amountMinor: number
  amountMajor: number
}

interface PoolRecord {
  id: string
  assetType: AssetType
  assetPrice: Money
  targetAmount: Money
  minContribution: Money
  status: "OPEN" | "FUNDED" | "CLOSED"
  currentRaised: Money
  investorCount: number
  remainingAmount: Money
  progressRatio: number
  description?: string
  createdAt: string
  userOwnershipUnits?: number
  userOwnershipBps?: number
  userInvested?: Money
}

function parseAmount(value: string) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed <= 0) return null
  return parsed
}

export default function OpenOpportunitiesPage() {
  const router = useRouter()
  const { toast } = useToast()
  const { user: authUser, loading: authLoading, refetch } = useAuth()

  const [pools, setPools] = useState<PoolRecord[]>([])
  const [isPoolsLoading, setIsPoolsLoading] = useState(true)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [walletBalance, setWalletBalance] = useState(0)

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isCreatingPool, setIsCreatingPool] = useState(false)
  const [newAssetType, setNewAssetType] = useState<AssetType>("SHUTTLE")
  const [newTargetAmount, setNewTargetAmount] = useState(String(DEFAULT_TARGETS.SHUTTLE))
  const [newMinContribution, setNewMinContribution] = useState("5000")
  const [newDescription, setNewDescription] = useState("")

  const [selectedPool, setSelectedPool] = useState<PoolRecord | null>(null)
  const [investAmount, setInvestAmount] = useState("")
  const [isInvestDialogOpen, setIsInvestDialogOpen] = useState(false)
  const [isSubmittingInvestment, setIsSubmittingInvestment] = useState(false)

  const investorName = getUserDisplayName(authUser, "Investor")

  const loadPools = useCallback(async () => {
    setIsPoolsLoading(true)
    try {
      const response = await fetch("/api/pools")
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || "Unable to load pools.")
      }
      setPools(payload.pools || [])
    } catch (error) {
      toast({
        title: "Unable to load pools",
        description: error instanceof Error ? error.message : "Please try again shortly.",
        variant: "destructive",
      })
    } finally {
      setIsPoolsLoading(false)
    }
  }, [toast])

  const loadWalletBalance = useCallback(async () => {
    try {
      const response = await fetch("/api/wallet/summary")
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || "Unable to fetch wallet balance.")
      }
      setWalletBalance(payload.wallet?.internalBalance?.amountMajor || 0)
    } catch {
      setWalletBalance(authUser?.availableBalance || 0)
    }
  }, [authUser?.availableBalance])

  const refreshPageData = async () => {
    setIsRefreshing(true)
    await Promise.all([loadPools(), loadWalletBalance(), refetch?.()])
    setIsRefreshing(false)
  }

  const resetCreateForm = () => {
    setNewAssetType("SHUTTLE")
    setNewTargetAmount(String(DEFAULT_TARGETS.SHUTTLE))
    setNewMinContribution("5000")
    setNewDescription("")
  }

  const handleCreatePool = async () => {
    const targetAmount = parseAmount(newTargetAmount)
    const minContribution = parseAmount(newMinContribution)

    if (!targetAmount || !minContribution) {
      toast({
        title: "Invalid input",
        description: "Provide valid target and minimum contribution amounts.",
        variant: "destructive",
      })
      return
    }

    setIsCreatingPool(true)
    try {
      const response = await fetch("/api/pools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          assetType: newAssetType,
          targetAmountNgn: targetAmount,
          minContributionNgn: minContribution,
          description: newDescription.trim() || undefined,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || "Unable to create pool.")
      }

      toast({
        title: "Pool created",
        description: `${newAssetType} investment pool created successfully.`,
      })

      setIsCreateDialogOpen(false)
      resetCreateForm()
      await loadPools()
    } catch (error) {
      toast({
        title: "Create pool failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsCreatingPool(false)
    }
  }

  const handleOpenInvestDialog = (pool: PoolRecord) => {
    setSelectedPool(pool)
    setInvestAmount("")
    setIsInvestDialogOpen(true)
  }

  const handleInvest = async () => {
    if (!selectedPool) return

    const amountNgn = parseAmount(investAmount)
    if (!amountNgn) {
      toast({
        title: "Invalid amount",
        description: "Enter a valid investment amount.",
        variant: "destructive",
      })
      return
    }

    setIsSubmittingInvestment(true)
    try {
      const response = await fetch(`/api/pools/${selectedPool.id}/invest`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountNgn }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || "Unable to submit investment.")
      }

      toast({
        title: "Investment confirmed",
        description: `${formatNaira(amountNgn)} invested into ${selectedPool.assetType} pool.`,
      })

      setIsInvestDialogOpen(false)
      setInvestAmount("")
      setSelectedPool(null)

      setWalletBalance(payload.investment?.userBalance?.amountMajor ?? walletBalance)
      await Promise.all([loadPools(), refetch?.()])
    } catch (error) {
      toast({
        title: "Investment failed",
        description: error instanceof Error ? error.message : "Please try again.",
        variant: "destructive",
      })
    } finally {
      setIsSubmittingInvestment(false)
    }
  }

  useEffect(() => {
    void Promise.all([loadPools(), loadWalletBalance()])
  }, [loadPools, loadWalletBalance])

  const openPoolsCount = useMemo(() => pools.filter((pool) => pool.status === "OPEN").length, [pools])

  if (authLoading) {
    return <DashboardRouteLoading title="Loading opportunities" description="Preparing pool and wallet data." />
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
    <>
      <DashboardShell role="investor" header={<Header userStatus="Verified Investor" />}>
        <main className="space-y-6 p-4 sm:p-6 lg:p-8">
          <section className="rounded-2xl border bg-card p-5 sm:p-6">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
              <div className="space-y-2">
                <Badge variant="secondary" className="w-fit">
                  Open opportunities
                </Badge>
                <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
                  Fractional pools for {investorName}
                </h1>
                <p className="max-w-2xl text-sm text-muted-foreground sm:text-base">
                  Browse active pools, create new opportunities, and invest directly from your internal NGN wallet.
                </p>
              </div>

              <div className="space-y-2 sm:min-w-[280px]">
                <div className="rounded-xl border bg-muted/20 p-3 text-sm">
                  <p className="text-muted-foreground">Internal balance</p>
                  <p className="text-lg font-semibold">{formatNaira(walletBalance)}</p>
                </div>
                <div className="rounded-xl border bg-muted/20 p-3 text-sm">
                  <p className="text-muted-foreground">Open pools</p>
                  <p className="text-lg font-semibold">{openPoolsCount}</p>
                </div>
              </div>
            </div>
          </section>

          <section className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Layers className="h-4 w-4" />
              Pool list with real-time ownership and progress
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" onClick={refreshPageData} disabled={isRefreshing} className="w-full sm:w-auto">
                {isRefreshing ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Refreshing
                  </>
                ) : (
                  "Refresh"
                )}
              </Button>
              <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
                <DialogTrigger asChild>
                  <Button className="w-full bg-[#E57700] text-white hover:bg-[#E57700]/90 sm:w-auto">
                    <Plus className="mr-2 h-4 w-4" />
                    Create pool
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Create investment pool</DialogTitle>
                    <DialogDescription>
                      Define a new fractional pool opportunity for shuttle or keke assets.
                    </DialogDescription>
                  </DialogHeader>

                  <div className="space-y-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="pool-asset-type">Asset type</Label>
                      <Select
                        value={newAssetType}
                        onValueChange={(value) => {
                          const nextType = value as AssetType
                          setNewAssetType(nextType)
                          setNewTargetAmount(String(DEFAULT_TARGETS[nextType]))
                        }}
                      >
                        <SelectTrigger id="pool-asset-type">
                          <SelectValue placeholder="Select asset type" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="SHUTTLE">Shuttle (N4,600,000)</SelectItem>
                          <SelectItem value="KEKE">Keke (N3,500,000)</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="pool-target">Target amount (NGN)</Label>
                      <Input
                        id="pool-target"
                        type="number"
                        inputMode="decimal"
                        value={newTargetAmount}
                        onChange={(event) => setNewTargetAmount(event.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="pool-min-contribution">Minimum contribution (NGN)</Label>
                      <Input
                        id="pool-min-contribution"
                        type="number"
                        inputMode="decimal"
                        value={newMinContribution}
                        onChange={(event) => setNewMinContribution(event.target.value)}
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="pool-description">Description (optional)</Label>
                      <Textarea
                        id="pool-description"
                        value={newDescription}
                        onChange={(event) => setNewDescription(event.target.value)}
                        placeholder="Add a short description for investors"
                      />
                    </div>
                  </div>

                  <DialogFooter>
                    <Button variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                      Cancel
                    </Button>
                    <Button
                      onClick={handleCreatePool}
                      disabled={isCreatingPool}
                      className="bg-[#E57700] text-white hover:bg-[#E57700]/90"
                    >
                      {isCreatingPool ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Creating
                        </>
                      ) : (
                        <>
                          Create pool
                          <ChevronRight className="ml-2 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </section>

          <section>
            {isPoolsLoading ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((_, index) => (
                  <Card key={index}>
                    <CardHeader>
                      <Skeleton className="h-5 w-32" />
                      <Skeleton className="h-4 w-48" />
                    </CardHeader>
                    <CardContent className="space-y-2">
                      <Skeleton className="h-4 w-full" />
                      <Skeleton className="h-2 w-full" />
                      <Skeleton className="h-10 w-full" />
                    </CardContent>
                  </Card>
                ))}
              </div>
            ) : pools.length === 0 ? (
              <Card>
                <CardContent className="py-10 text-center">
                  <h3 className="font-semibold">No pools available yet</h3>
                  <p className="mt-1 text-sm text-muted-foreground">Create the first opportunity to get started.</p>
                </CardContent>
              </Card>
            ) : (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                {pools.map((pool) => {
                  const progress = Math.min(pool.progressRatio * 100, 100)
                  const userOwnership = (pool.userOwnershipBps || 0) / 100
                  const isInvestable = pool.status === "OPEN"

                  return (
                    <Card key={pool.id} className="flex h-full flex-col">
                      <CardHeader className="space-y-3">
                        <div className="flex items-start justify-between">
                          <div>
                            <CardTitle className="text-base">{pool.assetType}</CardTitle>
                            <CardDescription>Asset price: {formatNaira(pool.assetPrice.amountMajor)}</CardDescription>
                          </div>
                          <Badge variant={pool.status === "OPEN" ? "default" : "secondary"}>{pool.status}</Badge>
                        </div>
                        {pool.description ? <p className="text-sm text-muted-foreground">{pool.description}</p> : null}
                      </CardHeader>

                      <CardContent className="flex flex-1 flex-col gap-4">
                        <div className="space-y-1.5 text-sm">
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Target</span>
                            <span>{formatNaira(pool.targetAmount.amountMajor)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Raised</span>
                            <span>{formatNaira(pool.currentRaised.amountMajor)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Remaining</span>
                            <span>{formatNaira(pool.remainingAmount.amountMajor)}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-muted-foreground">Min contribution</span>
                            <span>{formatNaira(pool.minContribution.amountMajor)}</span>
                          </div>
                        </div>

                        <div className="space-y-1">
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Funding progress</span>
                            <span>{progress.toFixed(1)}%</span>
                          </div>
                          <Progress value={progress} className="h-2" />
                        </div>

                        <div className="space-y-1.5 rounded-lg border bg-muted/30 p-2.5 text-xs">
                          <p className="flex items-center gap-1.5 text-muted-foreground">
                            <Users className="h-3.5 w-3.5" />
                            {pool.investorCount} investors invested
                          </p>
                          <p className="text-muted-foreground">Your ownership: {formatPercent(userOwnership, 2)}</p>
                          <p className="text-muted-foreground">You invested: {formatNaira(pool.userInvested?.amountMajor || 0)}</p>
                        </div>

                        <Button
                          className="mt-auto bg-[#E57700] text-white hover:bg-[#E57700]/90"
                          onClick={() => handleOpenInvestDialog(pool)}
                          disabled={!isInvestable}
                        >
                          <Wallet className="mr-2 h-4 w-4" />
                          {isInvestable ? "Invest from wallet" : "Not open"}
                        </Button>
                      </CardContent>
                    </Card>
                  )
                })}
              </div>
            )}
          </section>
        </main>
      </DashboardShell>

      <Dialog open={isInvestDialogOpen} onOpenChange={setIsInvestDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invest in {selectedPool?.assetType} pool</DialogTitle>
            <DialogDescription>
              Available balance: {formatNaira(walletBalance)}. Minimum contribution:{" "}
              {formatNaira(selectedPool?.minContribution.amountMajor || 0)}.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2">
            <Label htmlFor="pool-invest-amount">Amount (NGN)</Label>
            <Input
              id="pool-invest-amount"
              type="number"
              inputMode="decimal"
              value={investAmount}
              onChange={(event) => setInvestAmount(event.target.value)}
              placeholder="50000"
            />
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setIsInvestDialogOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={handleInvest}
              disabled={isSubmittingInvestment}
              className="bg-[#E57700] text-white hover:bg-[#E57700]/90"
            >
              {isSubmittingInvestment ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Investing...
                </>
              ) : (
                <>
                  Confirm investment
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}

