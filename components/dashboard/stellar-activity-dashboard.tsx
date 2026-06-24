"use client"

import { useEffect, useState, useMemo } from "react"
import { motion, AnimatePresence } from "framer-motion"
import {
  Activity,
  AlertCircle,
  ArrowDownLeft,
  ArrowUpRight,
  Check,
  Clock,
  Coins,
  Copy,
  Database,
  ExternalLink,
  FileCode,
  Info,
  Link as LinkIcon,
  Loader2,
  RefreshCw,
  Sparkles,
  Wallet,
} from "lucide-react"

import { getStellarDisplayConfig, buildStellarReferenceUrl } from "@/lib/stellar/display-config"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Skeleton } from "@/components/ui/skeleton"
import { useToast } from "@/hooks/use-toast"
import { StellarLinkForm } from "@/components/dashboard/stellar-link-form"

interface BalanceItem {
  asset: string
  balance: string
  type: string
  issuer?: string | null
  isPlaceholder?: boolean
}

interface SorobanEvent {
  contractId: string
  topics: string[]
  value: string
}

interface ActivityItem {
  id: string
  chainMoveRecordType: string
  eventType: string
  title: string
  amount: string
  asset: string
  date: string
  status: string
  sourceAccount: string
  destinationAccount: string | null
  reference: string
  sorobanEvents?: SorobanEvent[]
}

interface StellarDashboardData {
  network: string
  networkLabel: string
  horizonUrl: string
  rpcUrl: string
  contractId: string
  mock: boolean
  linkedAccount: string | null
  isFunded?: boolean
  balances: BalanceItem[]
  activities: ActivityItem[]
}

interface StellarActivityDashboardProps {
  role: "investor" | "admin"
}

export function StellarActivityDashboard({ role }: StellarActivityDashboardProps) {
  const { toast } = useToast()
  const [data, setData] = useState<StellarDashboardData | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isSyncing, setIsSyncing] = useState(false)
  const [copiedKey, setCopiedKey] = useState(false)
  const [activeTab, setActiveTab] = useState("all")

  // Load dashboard data
  const loadDashboardData = async (silent = false) => {
    if (!silent) setIsLoading(true)
    else setIsRefreshing(true)
    
    try {
      const response = await fetch("/api/stellar/activity")
      const result = await response.json()
      
      if (!response.ok) {
        throw new Error(result.error || "Failed to load dashboard data")
      }
      
      setData(result)
      setError(null)
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred.")
      toast({
        title: "Error loading activity",
        description: err.message || "Could not connect to the Stellar service.",
        variant: "destructive",
      })
    } finally {
      setIsLoading(false)
      setIsRefreshing(false)
    }
  }

  useEffect(() => {
    void loadDashboardData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Sync indexer (Admin only)
  const handleSyncIndexer = async () => {
    setIsSyncing(true)
    toast({
      title: "Syncing Indexer",
      description: "Fetching latest events from the Stellar network...",
    })

    try {
      const response = await fetch("/api/admin/stellar/sync", {
        method: "POST",
      })
      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || "Failed to sync indexer")
      }

      toast({
        title: "Sync Complete",
        description: `Successfully processed ${result.processed} new events. (${result.duplicates} duplicates, ${result.errors} errors).`,
      })

      // Reload dashboard data
      void loadDashboardData(true)
    } catch (err: any) {
      toast({
        title: "Sync Failed",
        description: err.message || "Could not sync the event indexer.",
        variant: "destructive",
      })
    } finally {
      setIsSyncing(false)
    }
  }

  // Copy public key to clipboard
  const handleCopyKey = async (key: string) => {
    try {
      await navigator.clipboard.writeText(key)
      setCopiedKey(true)
      setTimeout(() => setCopiedKey(false), 2000)
      toast({
        title: "Copied",
        description: "Public key copied to clipboard.",
      })
    } catch {
      // Fallback
    }
  }

  // Filter activities based on active tab
  const filteredActivities = useMemo(() => {
    if (!data?.activities) return []
    const activities = data.activities

    switch (activeTab) {
      case "payments":
        return activities.filter(
          (a) =>
            a.chainMoveRecordType === "wallet_funding" ||
            a.chainMoveRecordType === "unclassified" ||
            a.eventType === "payment"
        )
      case "pools":
        return activities.filter(
          (a) =>
            a.chainMoveRecordType === "investment" ||
            a.chainMoveRecordType === "pool_investment"
        )
      case "payouts":
        return activities.filter((a) => a.chainMoveRecordType === "payout")
      case "repayments":
        return activities.filter((a) => a.chainMoveRecordType === "repayment")
      case "soroban":
        return activities.filter(
          (a) =>
            a.eventType === "invoke_host_function" ||
            a.chainMoveRecordType === "contract_interaction" ||
            (a.sorobanEvents && a.sorobanEvents.length > 0)
        )
      default:
        return activities
    }
  }, [data?.activities, activeTab])

  // Get color configurations for assets
  const getAssetBadgeStyles = (asset: string) => {
    switch (asset.toUpperCase()) {
      case "XLM":
        return "bg-blue-500/10 text-blue-500 border-blue-500/20 hover:bg-blue-500/25"
      case "USDC":
        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20 hover:bg-emerald-500/25"
      case "CMOVE":
      case "MOVE":
        return "bg-amber-500/10 text-amber-500 border-amber-500/20 hover:bg-amber-500/25"
      default:
        return "bg-muted text-muted-foreground border-border hover:bg-muted/80"
    }
  }

  // Get status color configuration
  const getStatusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "confirmed":
      case "completed":
        return "bg-emerald-500/10 text-emerald-500 border-emerald-500/20"
      case "pending":
        return "bg-amber-500/10 text-amber-500 border-amber-500/20"
      case "failed":
        return "bg-destructive/10 text-destructive border-destructive/20"
      default:
        return "bg-muted text-muted-foreground border-border"
    }
  }

  // Get event record icon
  const getEventIcon = (recordType: string) => {
    switch (recordType.toLowerCase()) {
      case "repayment":
        return <ArrowDownLeft className="h-4 w-4 text-emerald-500" />
      case "payout":
        return <ArrowUpRight className="h-4 w-4 text-amber-500" />
      case "investment":
      case "pool_investment":
        return <Coins className="h-4 w-4 text-blue-500" />
      case "wallet_funding":
        return <Wallet className="h-4 w-4 text-purple-500" />
      case "contract_interaction":
        return <FileCode className="h-4 w-4 text-cyan-500" />
      default:
        return <Activity className="h-4 w-4 text-muted-foreground" />
    }
  }

  // Helper to construct link
  const getExplorerLink = (ref: string) => {
    if (!data) return "#"
    const displayConfig = {
      network: data.network as any,
      explorerBaseUrl: data.network === "mainnet"
        ? "https://stellar.expert/explorer/public"
        : "https://stellar.expert/explorer/testnet",
      mock: data.mock,
      demoPublicKey: "GD3MOCKACCOUNT123456789",
    }
    return buildStellarReferenceUrl(ref, displayConfig) || "#"
  }

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-2">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-80" />
          </div>
          <Skeleton className="h-10 w-28" />
        </div>
        <div className="grid gap-6 md:grid-cols-3">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
        <Skeleton className="h-96" />
      </div>
    )
  }

  if (error) {
    return (
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-destructive">
            <AlertCircle className="h-5 w-5" />
            Error Loading Stellar Dashboard
          </CardTitle>
          <CardDescription className="text-destructive/80">
            We couldn&apos;t load the on-chain activity because of a connectivity problem.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
          <Button variant="outline" onClick={() => void loadDashboardData()}>
            <RefreshCw className="mr-2 h-4 w-4" />
            Try Again
          </Button>
        </CardContent>
      </Card>
    )
  }

  const isDemo = data?.mock || false
  const activeKey = data?.linkedAccount || ""
  const isAccountFunded = data?.isFunded !== false

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-foreground flex items-center gap-2">
            <Sparkles className="h-7 w-7 text-amber-500 animate-pulse" />
            Stellar Activity Hub
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {role === "admin"
              ? "Monitor aggregated Stellar ledger events and system-wide asset distributions."
              : "Track your personal asset ownership, payment activities, and smart contract allocations."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {role === "admin" && (
            <Button
              type="button"
              disabled={isSyncing || isRefreshing}
              variant="outline"
              className="bg-amber-600/10 text-amber-500 border-amber-600/20 hover:bg-amber-600 hover:text-white"
              onClick={handleSyncIndexer}
            >
              {isSyncing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Syncing…
                </>
              ) : (
                <>
                  <Database className="mr-2 h-4 w-4" />
                  Sync Indexer
                </>
              )}
            </Button>
          )}

          <Button
            type="button"
            variant="outline"
            disabled={isRefreshing}
            onClick={() => void loadDashboardData(true)}
            className="border-border hover:bg-muted"
          >
            <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
            <span className="sr-only">Refresh Dashboard</span>
          </Button>
        </div>
      </div>

      {/* Network Configuration Bar */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card className="border-border/60 bg-card/45 backdrop-blur-[2px] transition-all hover:border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Stellar Network</p>
              <p className="text-lg font-bold text-foreground mt-0.5">{data?.networkLabel}</p>
            </div>
            <Badge variant={data?.network === "mainnet" ? "green" : "secondary"}>
              {data?.network === "mainnet" ? "Production" : "Testnet"}
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/45 backdrop-blur-[2px] transition-all hover:border-border">
          <CardContent className="p-4 flex items-center justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Ledger Integration</p>
              <p className="text-lg font-bold text-foreground mt-0.5">{isDemo ? "Simulated Mode" : "On-chain Mode"}</p>
            </div>
            <Badge variant={isDemo ? "outline" : "green"} className={isDemo ? "border-amber-500/30 text-amber-500 bg-amber-500/5" : ""}>
              {isDemo ? "Mock Enabled" : "Live Horizon"}
            </Badge>
          </CardContent>
        </Card>

        <Card className="border-border/60 bg-card/45 backdrop-blur-[2px] transition-all hover:border-border sm:col-span-2">
          <CardContent className="p-4 flex items-center justify-between gap-4 overflow-hidden">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Horizon Endpoint</p>
              <p className="text-sm font-mono truncate text-muted-foreground mt-0.5" title={data?.horizonUrl}>
                {data?.horizonUrl}
              </p>
            </div>
            <Info className="h-5 w-5 text-muted-foreground shrink-0" />
          </CardContent>
        </Card>
      </div>

      {/* Account Status / Linking Section */}
      <Card className="border-border/60 bg-gradient-to-br from-card to-card/75 overflow-hidden shadow-md">
        <CardContent className="p-6">
          {!activeKey ? (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-lg font-bold text-foreground flex items-center gap-2">
                    <LinkIcon className="h-5 w-5 text-amber-500" />
                    No Stellar Account Linked
                  </h3>
                  <p className="text-sm text-muted-foreground max-w-2xl">
                    Connect a Stellar public key (G...) to activate automated settlement tracking, asset distributions, and repayments.
                  </p>
                </div>
              </div>
              <div className="max-w-xl pt-2">
                <StellarLinkForm onLinked={() => void loadDashboardData(true)} />
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-bold text-foreground">Linked Public Key</h3>
                    {isDemo && (
                      <Badge variant="outline" className="border-amber-500/30 text-amber-500 bg-amber-500/5">
                        Demo Account
                      </Badge>
                    )}
                    {!isAccountFunded && (
                      <Badge variant="destructive" className="animate-pulse">
                        Unfunded on Testnet
                      </Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 bg-muted/40 p-2.5 rounded-lg border border-border/50 font-mono text-xs md:text-sm break-all">
                    <span>{activeKey}</span>
                    <div className="flex items-center gap-1.5 shrink-0 ml-auto pl-2">
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 hover:bg-muted"
                        onClick={() => handleCopyKey(activeKey)}
                      >
                        {copiedKey ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8 hover:bg-muted"
                        asChild
                      >
                        <a href={getExplorerLink(activeKey)} target="_blank" rel="noreferrer">
                          <ExternalLink className="h-4 w-4" />
                        </a>
                      </Button>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 md:self-end">
                  <Badge variant="green" className="text-xs px-2.5 py-1">
                    Linked Successful
                  </Badge>
                  {!isDemo && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="text-xs h-7 hover:bg-muted"
                      onClick={() => void loadDashboardData(true)}
                    >
                      Verify Balance
                    </Button>
                  )}
                </div>
              </div>

              {!isAccountFunded && (
                <Alert variant="warning" className="border-amber-500/30 bg-amber-500/5 text-amber-600 dark:text-amber-400">
                  <AlertCircle className="h-4 w-4" />
                  <AlertTitle className="font-semibold">Account Unfunded</AlertTitle>
                  <AlertDescription className="text-xs mt-1">
                    This public key has not been funded yet. Fund it with friendbot or transfer XLM on testnet to activate your account.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Asset Balances Grid */}
      {activeKey && (
        <div className="space-y-3">
          <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-1.5">
            <Coins className="h-5 w-5 text-muted-foreground" />
            Asset Ownership Records
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {data?.balances && data.balances.length > 0 ? (
              data.balances.map((b) => (
                <motion.div
                  key={b.asset}
                  whileHover={{ scale: 1.02 }}
                  className="rounded-xl border border-border/55 bg-gradient-to-br from-card to-card/65 p-5 shadow-sm transition-all duration-300 hover:shadow-md"
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-xs font-bold uppercase tracking-widest px-2.5 py-0.5 rounded-full border ${getAssetBadgeStyles(b.asset)}`}>
                      {b.asset}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      {b.type === "native" ? "Native Asset" : "Credit Token"}
                    </span>
                  </div>
                  <div className="mt-4">
                    <p className="text-3xl font-extrabold tracking-tight text-foreground font-mono">
                      {Number(b.balance).toLocaleString("en-US", { minimumFractionDigits: 2 })}
                    </p>
                    <p className="text-xs text-muted-foreground mt-1 truncate">
                      {b.issuer ? `Issuer: ${b.issuer.slice(0, 8)}...${b.issuer.slice(-8)}` : "Issuer: Stellar Core Ledger"}
                    </p>
                  </div>
                </motion.div>
              ))
            ) : (
              <div className="col-span-full rounded-xl border border-dashed border-border bg-muted/20 p-8 text-center text-sm text-muted-foreground">
                No active asset holdings found. Fund your account with asset tokens to view balances here.
              </div>
            )}
          </div>
        </div>
      )}

      {/* Soroban Smart Contract details */}
      <Card className="border-border/60 bg-gradient-to-r from-cyan-950/5 to-blue-950/5">
        <CardHeader>
          <div className="flex items-center gap-2">
            <FileCode className="h-5 w-5 text-cyan-500" />
            <CardTitle>Soroban Smart Contract Readiness</CardTitle>
          </div>
          <CardDescription>
            Smart contract interactions deployed to manage automated vehicle pools.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Active Contract Address</span>
              <div className="flex items-center gap-2 p-2 bg-muted/50 border border-border/50 rounded font-mono text-xs text-muted-foreground truncate">
                <span>{data?.contractId || "replace_after_deployment"}</span>
              </div>
            </div>
            <div className="space-y-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">Integration Status</span>
              <div className="flex items-center gap-2 pt-1">
                <Badge className="bg-cyan-500/10 border-cyan-500/20 text-cyan-400">
                  Soroban Ready
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Events are actively indexed and mapped to ChainMove pools.
                </span>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Activity Timeline */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold tracking-tight text-foreground flex items-center gap-2">
            <Clock className="h-5 w-5 text-muted-foreground" />
            Stellar Ledger Timeline
          </h2>
        </div>

        <Tabs defaultValue="all" onValueChange={setActiveTab} className="w-full">
          <TabsList className="bg-muted/65 border border-border/60 grid grid-cols-3 md:flex md:flex-wrap h-auto gap-1 p-1">
            <TabsTrigger value="all" className="data-[state=active]:bg-background">All Events</TabsTrigger>
            <TabsTrigger value="payments" className="data-[state=active]:bg-background">Payments</TabsTrigger>
            <TabsTrigger value="pools" className="data-[state=active]:bg-background">Pool Ownership</TabsTrigger>
            <TabsTrigger value="payouts" className="data-[state=active]:bg-background">Payouts</TabsTrigger>
            <TabsTrigger value="repayments" className="data-[state=active]:bg-background">Repayments</TabsTrigger>
            <TabsTrigger value="soroban" className="data-[state=active]:bg-background">Soroban logs</TabsTrigger>
          </TabsList>

          <TabsContent value={activeTab} className="mt-4">
            <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
              <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-border/60">
                  <thead className="bg-muted/30">
                    <tr className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                      <th className="px-5 py-4 font-semibold">Event Details</th>
                      <th className="px-5 py-4 font-semibold">Asset / Amount</th>
                      <th className="px-5 py-4 font-semibold hidden md:table-cell">Source / Destination</th>
                      <th className="px-5 py-4 font-semibold">Status / Date</th>
                      <th className="px-5 py-4 font-semibold text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/50 bg-background text-sm">
                    <AnimatePresence mode="popLayout">
                      {filteredActivities.length > 0 ? (
                        filteredActivities.map((a) => (
                          <motion.tr
                            key={a.id}
                            layout
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            exit={{ opacity: 0, y: -10 }}
                            transition={{ duration: 0.2 }}
                            className="align-middle hover:bg-muted/10 transition-colors"
                          >
                            <td className="px-5 py-4">
                              <div className="flex items-center gap-3">
                                <div className="p-2 rounded-lg border border-border/60 bg-muted/40 shrink-0">
                                  {getEventIcon(a.chainMoveRecordType)}
                                </div>
                                <div className="min-w-0">
                                  <p className="font-bold text-foreground leading-snug">{a.title}</p>
                                  <p className="text-xs text-muted-foreground mt-0.5 truncate max-w-[200px]" title={a.id}>
                                    Operation ID: {a.id}
                                  </p>
                                </div>
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex flex-col">
                                <span className="font-mono font-extrabold text-foreground">
                                  {a.eventType === "invoke_host_function" ? "—" : `${Number(a.amount).toLocaleString("en-US", { minimumFractionDigits: 2 })}`}
                                </span>
                                <span className={`text-[10px] uppercase font-bold tracking-wider mt-0.5 ${a.eventType === "invoke_host_function" ? "text-cyan-500" : ""}`}>
                                  {a.eventType === "invoke_host_function" ? "Soroban Invoc" : a.asset}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-4 hidden md:table-cell">
                              <div className="text-xs font-mono space-y-1 text-muted-foreground">
                                <p className="truncate max-w-[180px]" title={a.sourceAccount}>
                                  From: {a.sourceAccount.slice(0, 6)}...{a.sourceAccount.slice(-6)}
                                </p>
                                {a.destinationAccount && (
                                  <p className="truncate max-w-[180px]" title={a.destinationAccount}>
                                    To: {a.destinationAccount.slice(0, 6)}...{a.destinationAccount.slice(-6)}
                                  </p>
                                )}
                              </div>
                            </td>
                            <td className="px-5 py-4">
                              <div className="flex flex-col gap-1.5">
                                <span className={`inline-flex self-start items-center px-2 py-0.5 rounded-full border text-[10px] font-bold ${getStatusColor(a.status)}`}>
                                  {a.status}
                                </span>
                                <span className="text-[11px] text-muted-foreground font-medium">
                                  {new Date(a.date).toLocaleString("en-US", {
                                    month: "short",
                                    day: "numeric",
                                    hour: "2-digit",
                                    minute: "2-digit",
                                  })}
                                </span>
                              </div>
                            </td>
                            <td className="px-5 py-4 text-right">
                              <Button
                                size="sm"
                                variant="ghost"
                                className="h-8 hover:bg-muted text-xs hover:text-amber-500"
                                asChild
                              >
                                <a href={getExplorerLink(a.reference)} target="_blank" rel="noreferrer">
                                  View on Explorer
                                  <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
                                </a>
                              </Button>
                            </td>
                          </motion.tr>
                        ))
                      ) : (
                        <tr className="align-middle">
                          <td colSpan={5} className="px-5 py-12 text-center text-sm text-muted-foreground">
                            <Activity className="h-8 w-8 mx-auto text-muted-foreground/45 mb-2.5 animate-pulse" />
                            No activity found matching this filter.
                          </td>
                        </tr>
                      )}
                    </AnimatePresence>
                  </tbody>
                </table>
              </div>
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}
