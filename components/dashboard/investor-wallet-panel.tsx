"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { formatEther } from "viem"
import {
  ArrowRight,
  CheckCircle2,
  ChevronRight,
  Copy,
  ExternalLink,
  Loader2,
  Wallet,
} from "lucide-react"

import { useAuth } from "@/hooks/use-auth"
import { formatNaira } from "@/lib/currency"
import { getPrivyFundingErrorMessage, startPrivyFunding } from "@/lib/auth/privy-funding"
import { useFundWallet, useWallets } from "@/lib/privy/react-auth"
import { cn } from "@/lib/utils"
import { InvestorWalletDedicatedAccountCard } from "@/components/dashboard/investor-wallet-dedicated-account-card"
import { useToast } from "@/hooks/use-toast"
import { isMockStellar } from "@/lib/mock-stellar/mockConfig"
import { mockAccount } from "@/lib/mock-stellar/mockAccount"
import { mockAssets } from "@/lib/mock-stellar/mockAssets"
import { mockActivity } from "@/lib/mock-stellar/mockActivity"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"
import { CURRENT_EMBEDDED_WALLET, getWalletDisplay, shortenWalletAddress } from "@/lib/wallet/config"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"

interface WalletTransaction {
  id: string
  type: string
  amount: number
  currency: string
  status: string
  method?: string
  description: string
  reference?: string
  timestamp: string
}

interface WalletSummaryPayload {
  wallet: {
    internalBalanceNgn: number
    walletAddress: string | null
  }
  transactions: WalletTransaction[]
}

interface InvestorWalletPanelProps {
  sectionId?: string
  className?: string
  showTitle?: boolean
}

function toPaystackAmount(value: string) {
  const parsed = Number.parseFloat(value)
  if (!Number.isFinite(parsed)) return null
  if (parsed <= 0) return null
  return parsed
}

function normalizeEmail(value: string) {
  return value.trim().toLowerCase()
}

function isValidEmail(value: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}

async function resolveOnchainBalance(address: string) {
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
  if (typeof payload?.result !== "string") return null

  const balance = Number.parseFloat(formatEther(BigInt(payload.result)))
  if (!Number.isFinite(balance)) return null
  return `${balance.toFixed(4)} ${CURRENT_EMBEDDED_WALLET.network.nativeAsset}`
}

export function InvestorWalletPanel({ sectionId = "wallet", className, showTitle = true }: InvestorWalletPanelProps) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const { toast } = useToast()
  const { user: authUser, refetch: refetchAuth } = useAuth()
  const { wallets } = useWallets()
  const { fundWallet } = useFundWallet()

  const [walletSummary, setWalletSummary] = useState<WalletSummaryPayload | null>(null)
  const [isSummaryLoading, setIsSummaryLoading] = useState(true)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [isVerifyingPayment, setIsVerifyingPayment] = useState(false)
  const [isPrivyFunding, setIsPrivyFunding] = useState(false)
  const [isPaystackFunding, setIsPaystackFunding] = useState(false)
  const [paystackAmount, setPaystackAmount] = useState("")
  const [paystackEmail, setPaystackEmail] = useState(authUser?.email || "")
  const [onchainBalance, setOnchainBalance] = useState<string | null>(null)
  const [onchainLoading, setOnchainLoading] = useState(false)

  const embeddedWallet = useMemo(
    () => wallets.find((wallet) => wallet.walletClientType === "privy" || wallet.walletClientType === "privy-v2"),
    [wallets],
  )

  const walletAddress = isMockStellar ? mockAccount.publicKey : (walletSummary?.wallet.walletAddress || embeddedWallet?.address || authUser?.walletAddress || "")
  const walletDisplay = getWalletDisplay({
    embeddedWalletAddress: walletAddress,
    stellarPublicKey: isMockStellar ? mockAccount.publicKey : authUser?.stellarPublicKey,
  })
  const internalBalance = walletSummary?.wallet.internalBalanceNgn || 0

  const fundingTransactions = useMemo(() => {
    if (isMockStellar) {
      return mockActivity.map(activity => ({
        id: activity.id,
        type: activity.type,
        amount: Number.parseFloat(activity.amount),
        currency: "USD",
        status: activity.status,
        method: "Stellar Demo",
        description: activity.type,
        timestamp: activity.timestamp,
      }))
    }
    if (!walletSummary?.transactions) return []
    return walletSummary.transactions
      .filter((tx) => tx.type === "wallet_funding" || tx.type === "deposit")
      .slice(0, 10)
  }, [walletSummary])

  const loadWalletSummary = useCallback(async () => {
    setIsSummaryLoading(true)
    setSummaryError(null)

    if (isMockStellar) {
      setWalletSummary({
        wallet: { internalBalanceNgn: 150000, walletAddress: mockAccount.publicKey },
        transactions: []
      })
      setIsSummaryLoading(false)
      return
    }

    try {
      const response = await fetch("/api/wallet/summary")
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || "Unable to load wallet summary.")
      }

      setWalletSummary(payload)
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Unable to load wallet summary.")
    } finally {
      setIsSummaryLoading(false)
    }
  }, [])

  const clearReferenceQuery = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString())
    params.delete("reference")
    const query = params.toString()
    router.replace(query ? `${pathname}?${query}` : pathname)
  }, [pathname, router, searchParams])

  const verifyPaymentReference = useCallback(
    async (reference: string) => {
      setIsVerifyingPayment(true)
      try {
        const response = await fetch("/api/payments/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ reference }),
        })
        const payload = await response.json()
        if (!response.ok) {
          throw new Error(payload.message || "Payment verification failed.")
        }

        toast({
          title: "Wallet funded",
          description: `Your internal wallet was credited with ${formatNaira(payload.amountNgn || 0)}.`,
        })

        await Promise.all([loadWalletSummary(), refetchAuth?.()])
      } catch (error) {
        toast({
          title: "Verification failed",
          description: error instanceof Error ? error.message : "Unable to verify this payment.",
          variant: "destructive",
        })
      } finally {
        setIsVerifyingPayment(false)
        clearReferenceQuery()
      }
    },
    [clearReferenceQuery, loadWalletSummary, refetchAuth, toast],
  )

  const openWalletExplorer = () => {
    if (!walletDisplay.explorerUrl) return
    window.open(walletDisplay.explorerUrl, "_blank", "noopener,noreferrer")
  }

  const handleOpenWalletView = () => {
    if (!walletDisplay.explorerUrl) {
      toast({
        title: "Wallet unavailable",
        description: "Your embedded wallet address is not ready yet. Please sign out and sign in again.",
        variant: "destructive",
      })
      return
    }

    openWalletExplorer()
    toast({
      title: "Wallet address ready",
      description: "Use your wallet address to receive onchain funds, or use Paystack for NGN funding.",
    })
  }

  const handlePrivyFunding = async () => {
    if (isMockStellar) {
      toast({
        title: "Mock Demo",
        description: "Funding disabled in demo mode.",
      })
      return
    }

    if (!walletAddress) {
      toast({
        title: "Wallet unavailable",
        description: "Your embedded wallet address is not ready yet. Please sign out and sign in again.",
        variant: "destructive",
      })
      return
    }

    setIsPrivyFunding(true)
    try {
      await startPrivyFunding({
        walletAddress,
        embeddedWallet,
        fundWallet,
      })
      toast({
        title: "Privy funding flow opened",
        description: "Complete the flow to top up your onchain wallet.",
      })
    } catch (error) {
      toast({
        title: "Unable to start Privy funding",
        description: getPrivyFundingErrorMessage(error),
        variant: "destructive",
      })
    } finally {
      setIsPrivyFunding(false)
      if (walletAddress) {
        setOnchainLoading(true)
        resolveOnchainBalance(walletAddress)
          .then((balance) => {
            setOnchainBalance(balance)
          })
          .catch(() => {
            setOnchainBalance(null)
          })
          .finally(() => {
            setOnchainLoading(false)
          })
      }
    }
  }

  const handlePaystackFunding = async () => {
    const amountNgn = toPaystackAmount(paystackAmount)
    if (!amountNgn) {
      toast({
        title: "Invalid amount",
        description: "Enter a valid amount in Naira.",
        variant: "destructive",
      })
      return
    }

    const email = normalizeEmail(paystackEmail || authUser?.email || "")
    if (!email) {
      toast({
        title: "Email required",
        description: "Enter an email address to continue with Paystack funding.",
        variant: "destructive",
      })
      return
    }

    if (!isValidEmail(email)) {
      toast({
        title: "Invalid email",
        description: "Enter a valid email address.",
        variant: "destructive",
      })
      return
    }

    setIsPaystackFunding(true)
    try {
      const response = await fetch("/api/payments/initialize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountNgn,
          email,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.message || "Unable to initialize Paystack funding.")
      }

      const redirectUrl = payload?.data?.authorization_url
      if (!redirectUrl) {
        throw new Error("Missing Paystack authorization URL.")
      }

      window.location.href = redirectUrl
    } catch (error) {
      toast({
        title: "Funding failed",
        description: error instanceof Error ? error.message : "Unable to initialize payment.",
        variant: "destructive",
      })
    } finally {
      setIsPaystackFunding(false)
    }
  }

  const handleCopyAddress = async () => {
    if (!walletDisplay.address) return
    await navigator.clipboard.writeText(walletDisplay.address)
    toast({
      title: "Address copied",
      description: "Wallet address copied to clipboard.",
    })
  }

  useEffect(() => {
    loadWalletSummary()
  }, [loadWalletSummary])

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadWalletSummary()
      }
    }, 30000)

    const handleFocus = () => {
      void loadWalletSummary()
    }

    window.addEventListener("focus", handleFocus)

    return () => {
      window.clearInterval(interval)
      window.removeEventListener("focus", handleFocus)
    }
  }, [loadWalletSummary])

  useEffect(() => {
    const reference = searchParams.get("reference")
    if (!reference) return
    void verifyPaymentReference(reference)
  }, [searchParams, verifyPaymentReference])

  useEffect(() => {
    if (isMockStellar) {
      setOnchainBalance(mockAccount.balance)
      setOnchainLoading(false)
      return
    }

    if (!walletAddress) {
      setOnchainBalance(null)
      return
    }

    let isMounted = true
    setOnchainLoading(true)

    resolveOnchainBalance(walletAddress)
      .then((balance) => {
        if (isMounted) {
          setOnchainBalance(balance)
        }
      })
      .catch(() => {
        if (isMounted) {
          setOnchainBalance(null)
        }
      })
      .finally(() => {
        if (isMounted) {
          setOnchainLoading(false)
        }
      })

    return () => {
      isMounted = false
    }
  }, [walletAddress])

  useEffect(() => {
    if (authUser?.email && !paystackEmail) {
      setPaystackEmail(authUser.email)
    }
  }, [authUser?.email, paystackEmail])

  if (isSummaryLoading) {
    return (
      <Card id={sectionId} className={className}>
        <CardHeader>
          <Skeleton className="h-6 w-44" />
          <Skeleton className="h-4 w-72" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-28 w-full" />
        </CardContent>
      </Card>
    )
  }

  if (summaryError) {
    return (
      <Card id={sectionId} className={className}>
        <CardHeader>
          <CardTitle>Wallet</CardTitle>
          <CardDescription>Unable to load wallet state.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
            {summaryError}
          </div>
          <Button variant="outline" onClick={loadWalletSummary}>
            Retry
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card id={sectionId} className={cn("scroll-mt-24", className)}>
      {showTitle ? (
        <CardHeader>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                Wallet funding
              </CardTitle>
              <CardDescription>
                Fund via Privy or Paystack. Internal NGN balance is used for pool investments.
              </CardDescription>
            </div>
            {isVerifyingPayment ? (
              <Badge variant="secondary" className="w-fit">
                <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Verifying payment
              </Badge>
            ) : null}
          </div>
        </CardHeader>
      ) : null}

      <CardContent className="space-y-6">
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Internal NGN balance</p>
            <p className="mt-2 text-xl font-semibold">{formatNaira(internalBalance)}</p>
            <p className="mt-1 text-xs text-muted-foreground">Available for investments</p>
          </div>

          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">{walletDisplay.addressLabel}</p>
            <p className="mt-2 break-all font-mono text-sm">{walletDisplay.address ? shortenWalletAddress(walletDisplay.address) : "Not available"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{walletDisplay.networkLabel}</p>
            <div className="mt-2 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={handleCopyAddress} disabled={!walletDisplay.address}>
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy
              </Button>
              <Button variant="outline" size="sm" className="flex-1 sm:flex-none" onClick={handleOpenWalletView} disabled={!walletDisplay.explorerUrl}>
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Open wallet
              </Button>
            </div>
          </div>

          <div className="rounded-xl border bg-muted/20 p-4">
            <p className="text-xs uppercase tracking-wide text-muted-foreground">Onchain balance</p>
            {isMockStellar ? (
              <div className="mt-2 space-y-1">
                {mockAssets.map(asset => (
                  <div key={asset.code} className="flex justify-between items-center text-sm">
                    <span className="font-medium">{asset.code}</span>
                    <span>{asset.balance}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="mt-2 text-xl font-semibold">{onchainLoading ? "Loading..." : onchainBalance || "Unavailable"}</p>
            )}
            <p className="mt-1 text-xs text-muted-foreground">
              {isMockStellar ? "Stellar Mock Assets" : `${CURRENT_EMBEDDED_WALLET.network.label} embedded wallet`}
            </p>
          </div>
        </div>

        <InvestorWalletDedicatedAccountCard
          internalBalanceNgn={internalBalance}
          profileFullName={authUser?.fullName || authUser?.name || ""}
          profilePhoneNumber={authUser?.phoneNumber || ""}
          onProfileUpdated={async () => {
            await loadWalletSummary()
            refetchAuth?.()
          }}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border p-4">
            <h3 className="font-semibold">2. Fund via Privy wallet flow</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Use Privy on-ramp where supported, or copy your wallet address to receive funds on-chain.
            </p>
            <Button
              className="mt-3 w-full bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 sm:w-auto"
              onClick={handlePrivyFunding}
              disabled={isPrivyFunding || !walletAddress}
            >
              {isPrivyFunding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Opening flow...
                </>
              ) : (
                <>
                  Fund with Privy
                  <ChevronRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>

          <div className="rounded-xl border p-4">
            <h3 className="font-semibold">3. Fund via Paystack checkout</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              Fiat deposits are credited directly to your internal NGN wallet balance.
            </p>
            <div className="mt-3 space-y-2">
              <Label htmlFor="paystack-funding-email">Email</Label>
              <Input
                id="paystack-funding-email"
                inputMode="email"
                type="email"
                placeholder="you@example.com"
                value={paystackEmail}
                onChange={(event) => setPaystackEmail(event.target.value)}
              />
            </div>
            <div className="mt-3 space-y-2">
              <Label htmlFor="paystack-funding-amount">Amount (NGN)</Label>
              <Input
                id="paystack-funding-amount"
                inputMode="decimal"
                type="number"
                placeholder="50000"
                value={paystackAmount}
                onChange={(event) => setPaystackAmount(event.target.value)}
              />
            </div>
            <Button
              className="mt-3 w-full bg-amber-600 text-white hover:bg-amber-700 dark:bg-amber-500 dark:hover:bg-amber-400 sm:w-auto"
              onClick={handlePaystackFunding}
              disabled={isPaystackFunding}
            >
              {isPaystackFunding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Redirecting...
                </>
              ) : (
                <>
                  Continue to Paystack
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </div>
        </div>

        <div className="rounded-xl border">
          <div className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <h3 className="font-semibold">Recent funding transactions</h3>
            <Button variant="outline" size="sm" className="w-full sm:w-auto" onClick={loadWalletSummary}>
              Refresh
            </Button>
          </div>

          {fundingTransactions.length === 0 ? (
            <div className="p-6 text-sm text-muted-foreground">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4" />
                No funding transactions yet.
              </div>
            </div>
          ) : (
            <div className="space-y-3 p-4">
              <div className="space-y-2 md:hidden">
                {fundingTransactions.map((tx) => (
                  <article key={tx.id} className="rounded-lg border border-border/70 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs text-muted-foreground">{new Date(tx.timestamp).toLocaleString()}</p>
                      <Badge variant={tx.status.toLowerCase() === "completed" ? "default" : "secondary"}>{tx.status}</Badge>
                    </div>
                    <p className="mt-2 text-sm capitalize text-muted-foreground">{tx.method || tx.type.replaceAll("_", " ")}</p>
                    <p className="mt-1 text-sm font-semibold">{formatNaira(tx.amount)}</p>
                  </article>
                ))}
              </div>

              <div className="hidden md:block">
                <Table>
                  <TableHeader className="sticky top-0 z-10 bg-background">
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {fundingTransactions.map((tx) => (
                      <TableRow key={tx.id}>
                        <TableCell className="text-xs">{new Date(tx.timestamp).toLocaleString()}</TableCell>
                        <TableCell className="text-xs capitalize">{tx.method || tx.type.replaceAll("_", " ")}</TableCell>
                        <TableCell>
                          <Badge variant={tx.status.toLowerCase() === "completed" ? "default" : "secondary"}>
                            {tx.status}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right font-medium">{formatNaira(tx.amount)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
