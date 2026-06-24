"use client"

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react"
import { usePrivy, useWallets } from "@/lib/privy/react-auth"
import type {
  WalletState,
  WalletIdentity,
  BlockchainAccount,
  WalletNetwork,
} from "@/types/wallet"
import { createEmptyWalletState, getNetworkMetadata } from "@/types/wallet"

interface WalletContextValue {
  walletState: WalletState
  updateIdentity: (identity: Partial<WalletIdentity>) => void
  addAccount: (account: BlockchainAccount) => void
  setPrimaryAccount: (publicKey: string) => void
  switchNetwork: (network: WalletNetwork) => void
  refreshWallet: () => Promise<void>
}

const WalletContext = createContext<WalletContextValue | null>(null)

export function useWallet() {
  const context = useContext(WalletContext)
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider")
  }
  return context
}

interface WalletProviderProps {
  children: ReactNode
  defaultNetwork?: WalletNetwork
}

export function WalletProvider({ children, defaultNetwork = "stellar-testnet" }: WalletProviderProps) {
  const { ready: privyReady, authenticated, user: privyUser } = usePrivy()
  const { wallets } = useWallets()
  const [walletState, setWalletState] = useState<WalletState>(createEmptyWalletState(defaultNetwork))

  const refreshWallet = useCallback(async () => {
    if (!privyReady) {
      return
    }

    if (!authenticated || !privyUser) {
      setWalletState(createEmptyWalletState(defaultNetwork))
      return
    }

    try {
      const response = await fetch("/api/auth/me", { cache: "no-store" })
      if (!response.ok) {
        setWalletState(createEmptyWalletState(defaultNetwork))
        return
      }

      const userData = await response.json()

      const identity: WalletIdentity = {
        userId: userData.id || "",
        privyUserId: userData.privyUserId || privyUser.id || null,
        email: userData.email || privyUser.email?.address || null,
        phoneNumber: userData.phoneNumber || privyUser.phone?.number || null,
        name: userData.name || null,
        fullName: userData.fullName || userData.name || null,
      }

      const accounts: BlockchainAccount[] = []

      if (userData.stellarPublicKey) {
        accounts.push({
          publicKey: userData.stellarPublicKey,
          accountId: userData.stellarPublicKey,
          network: defaultNetwork === "stellar-mainnet" ? "stellar-mainnet" : "stellar-testnet",
          type: "stellar",
          linked: true,
        })
      }

      if (wallets && wallets.length > 0) {
        for (const wallet of wallets) {
          if (wallet.address && wallet.walletClientType === "privy") {
            accounts.push({
              publicKey: wallet.address.toLowerCase(),
              address: wallet.address.toLowerCase(),
              network: "lisk-sepolia",
              type: "embedded",
              linked: true,
            })
          }
        }
      }

      if (userData.walletAddress) {
        const existingEvmAccount = accounts.find(
          (acc) => acc.address?.toLowerCase() === userData.walletAddress.toLowerCase()
        )
        if (!existingEvmAccount) {
          accounts.push({
            publicKey: userData.walletAddress.toLowerCase(),
            address: userData.walletAddress.toLowerCase(),
            network: "lisk-sepolia",
            type: "evm",
            linked: true,
          })
        }
      }

      const primaryAccount = accounts.find((acc) => acc.type === "stellar") || accounts[0] || null

      setWalletState({
        identity,
        accounts,
        primaryAccount,
        metadata: getNetworkMetadata(defaultNetwork),
        isReady: true,
      })
    } catch (error) {
      console.error("Error refreshing wallet:", error)
      setWalletState(createEmptyWalletState(defaultNetwork))
    }
  }, [privyReady, authenticated, privyUser, wallets, defaultNetwork])

  useEffect(() => {
    let mounted = true

    const loadWallet = async () => {
      if (mounted) {
        await refreshWallet()
      }
    }

    loadWallet()

    return () => {
      mounted = false
    }
  }, [refreshWallet])

  const updateIdentity = useCallback((identity: Partial<WalletIdentity>) => {
    setWalletState((prev) => ({
      ...prev,
      identity: prev.identity ? { ...prev.identity, ...identity } : null,
    }))
  }, [])

  const addAccount = useCallback((account: BlockchainAccount) => {
    setWalletState((prev) => {
      const exists = prev.accounts.some((acc) => acc.publicKey === account.publicKey)
      if (exists) return prev

      return {
        ...prev,
        accounts: [...prev.accounts, account],
      }
    })
  }, [])

  const setPrimaryAccount = useCallback((publicKey: string) => {
    setWalletState((prev) => {
      const account = prev.accounts.find((acc) => acc.publicKey === publicKey)
      if (!account) return prev

      return {
        ...prev,
        primaryAccount: account,
      }
    })
  }, [])

  const switchNetwork = useCallback((network: WalletNetwork) => {
    setWalletState((prev) => ({
      ...prev,
      metadata: getNetworkMetadata(network),
    }))
  }, [])

  return (
    <WalletContext.Provider
      value={{
        walletState,
        updateIdentity,
        addAccount,
        setPrimaryAccount,
        switchNetwork,
        refreshWallet,
      }}
    >
      {children}
    </WalletContext.Provider>
  )
}
