"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { ChevronRight, Copy, ExternalLink, Loader2, Wallet } from "lucide-react"
import { formatEther } from "viem"

import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { formatNaira } from "@/lib/currency"
import { useAuth } from "@/hooks/use-auth"
import { getPrivyFundingErrorMessage, startPrivyFunding } from "@/lib/auth/privy-funding"
import { useToast } from "@/components/ui/use-toast"
import { useFundWallet, useWallets } from "@/lib/privy/react-auth"
import { CURRENT_EMBEDDED_WALLET, getWalletDisplay } from "@/lib/wallet/config"

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
  const balanceHex = payload?.result
  if (typeof balanceHex !== "string") return null

  const balance = formatEther(BigInt(balanceHex))
  const parsed = Number.parseFloat(balance)
  if (!Number.isFinite(parsed)) return null
  return `${parsed.toFixed(4)} ${CURRENT_EMBEDDED_WALLET.network.nativeAsset}`
}

export function WalletMenu() {
  const { user: authUser } = useAuth()
  const { toast } = useToast()
  const { wallets } = useWallets()
  const { fundWallet } = useFundWallet()
  const [isPrivyFunding, setIsPrivyFunding] = useState(false)

  const [onchainBalance, setOnchainBalance] = useState<{ address: string; value: string | null }>({
    address: "",
    value: null,
  })

  const embeddedWallet = useMemo(() => {
    return wallets.find((wallet) => wallet.walletClientType === "privy" || wallet.walletClientType === "privy-v2")
  }, [wallets])

  const walletAddress = embeddedWallet?.address || authUser?.walletAddress || ""
  const walletDisplay = getWalletDisplay({
    embeddedWalletAddress: walletAddress,
    stellarPublicKey: authUser?.stellarPublicKey,
  })
  const internalBalance = authUser?.availableBalance || 0
  const isBalanceLoading = Boolean(walletAddress) && onchainBalance.address !== walletAddress

  useEffect(() => {
    if (!walletAddress) {
      return
    }

    let isMounted = true

    resolveOnchainBalance(walletAddress)
      .then((balance) => {
        if (isMounted) {
          setOnchainBalance({ address: walletAddress, value: balance })
        }
      })
      .catch(() => {
        if (isMounted) {
          setOnchainBalance({ address: walletAddress, value: null })
        }
      })

    return () => {
      isMounted = false
    }
  }, [walletAddress])

  const copyAddress = async () => {
    if (!walletDisplay.address) return
    await navigator.clipboard.writeText(walletDisplay.address)
    toast({
      title: "Address copied",
      description: `${walletDisplay.addressLabel} copied to clipboard.`,
    })
  }

  const handleOpenWalletView = () => {
    if (!walletDisplay.explorerUrl) {
      toast({
        title: "No wallet address",
        description: "Sign in again to initialize your embedded wallet.",
        variant: "destructive",
      })
      return
    }

    window.open(walletDisplay.explorerUrl, "_blank", "noopener,noreferrer")
    toast({
      title: "Wallet address ready",
      description: "Use your address to receive funds, or continue with Paystack for NGN wallet funding.",
    })
  }

  const handleFundWithPrivy = async () => {
    if (!walletAddress) {
      toast({
        title: "Wallet unavailable",
        description: "Your embedded wallet address is not ready yet.",
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
        description: "Complete the funding flow to top up your onchain wallet.",
      })
    } catch (error) {
      toast({
        title: "Unable to start Privy funding",
        description: getPrivyFundingErrorMessage(error),
        variant: "destructive",
      })
    } finally {
      setIsPrivyFunding(false)
    }
  }

  if (authUser?.role !== "investor") return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="h-9">
          <Wallet className="mr-2 h-4 w-4" />
          {walletDisplay.shortAddress || "Wallet"}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80">
        <DropdownMenuLabel>
          {walletDisplay.label}
          <span className="ml-2 font-normal text-muted-foreground">{walletDisplay.networkLabel}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <div className="space-y-2 px-2 py-1.5 text-xs">
          <div className="rounded-md border bg-muted/30 p-2">
            <p className="text-muted-foreground">Internal NGN balance</p>
            <p className="text-sm font-semibold">{formatNaira(internalBalance)}</p>
          </div>
          <div className="rounded-md border bg-muted/30 p-2">
            <p className="text-muted-foreground">{CURRENT_EMBEDDED_WALLET.network.label} balance</p>
            <p className="text-sm font-semibold">
              {!walletAddress ? "Unavailable" : isBalanceLoading ? "Loading..." : onchainBalance.value || "Unavailable"}
            </p>
          </div>
        </div>

        <DropdownMenuItem onSelect={(event) => event.preventDefault()} className="cursor-default">
          <div className="flex w-full items-center justify-between gap-2">
            <span className="max-w-[180px] truncate text-xs">{walletDisplay.address || "No wallet linked"}</span>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={copyAddress} disabled={!walletDisplay.address}>
              <Copy className="h-3.5 w-3.5" />
            </Button>
          </div>
        </DropdownMenuItem>

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={(event) => event.preventDefault()} className="cursor-default">
          <Button
            onClick={handleFundWithPrivy}
            disabled={!walletAddress || isPrivyFunding}
            className="h-8 w-full bg-[#E57700] text-white hover:bg-[#E57700]/90"
          >
            {isPrivyFunding ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            Fund with Privy
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={(event) => event.preventDefault()} className="cursor-default">
          <Button
            onClick={handleOpenWalletView}
            disabled={!walletDisplay.explorerUrl}
            variant="outline"
            className="h-8 w-full"
          >
            <ExternalLink className="mr-2 h-4 w-4" />
            Open wallet / receive
            <ChevronRight className="ml-2 h-4 w-4" />
          </Button>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/dashboard/investor/wallet" className="flex w-full items-center justify-between">
            Fund with Paystack
            <ChevronRight className="h-4 w-4" />
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
