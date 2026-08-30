"use client"

import { useWallet as useWalletContext } from "@/contexts/wallet-context"
import { isStellarAccount, isEvmAccount, getPrimaryAccountAddress } from "@/types/wallet"

export function useWallet() {
  const {
    walletState,
    updateIdentity,
    addAccount,
    setPrimaryAccount,
    switchNetwork,
    refreshWallet,
  } = useWalletContext()

  const hasStellarAccount = walletState.accounts.some(isStellarAccount)
  const hasEvmAccount = walletState.accounts.some(isEvmAccount)
  const primaryAddress = getPrimaryAccountAddress(walletState)

  const stellarAccount = walletState.accounts.find(isStellarAccount)
  const evmAccount = walletState.accounts.find(isEvmAccount)

  return {
    walletState,
    identity: walletState.identity,
    accounts: walletState.accounts,
    primaryAccount: walletState.primaryAccount,
    primaryAddress,
    stellarAccount,
    evmAccount,
    hasStellarAccount,
    hasEvmAccount,
    isReady: walletState.isReady,
    network: walletState.metadata.network,
    networkLabel: walletState.metadata.networkLabel,
    isTestnet: walletState.metadata.isTestnet,
    updateIdentity,
    addAccount,
    setPrimaryAccount,
    switchNetwork,
    refreshWallet,
  }
}
