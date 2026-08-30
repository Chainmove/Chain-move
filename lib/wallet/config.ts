import { liskSepolia } from "viem/chains"

import type {
  EmbeddedWalletProviderConfig,
  PublicWalletDisplay,
  WalletDisplayInput,
  WalletModeConfig,
} from "./types"

export const CURRENT_EMBEDDED_WALLET: WalletModeConfig = {
  mode: "embedded-evm",
  label: "Privy embedded wallet",
  addressLabel: "Wallet",
  provider: "privy",
  status: "current",
  network: {
    id: "lisk-sepolia",
    label: "Lisk Sepolia",
    family: "evm",
    nativeAsset: "ETH",
    rpcUrl: liskSepolia.rpcUrls.default.http[0],
    explorerAddressBaseUrl: "https://sepolia-blockscout.lisk.com/address",
  },
}

export const PLANNED_STELLAR_WALLET: WalletModeConfig = {
  mode: "stellar-account",
  label: "Stellar account",
  addressLabel: "Stellar account",
  provider: "stellar",
  status: "planned",
  network: {
    id: "stellar-testnet",
    label: "Stellar Testnet",
    family: "stellar",
    nativeAsset: "XLM",
    explorerAddressBaseUrl: "https://stellar.expert/explorer/testnet/account",
  },
}

export const embeddedWalletProviderConfig: EmbeddedWalletProviderConfig = {
  loginMethods: ["email", "sms"],
  supportedChains: [liskSepolia],
  defaultChain: liskSepolia,
  embeddedWallets: {
    ethereum: {
      createOnLogin: "all-users",
    },
    showWalletUIs: true,
  },
  appearance: {
    theme: "light",
    accentColor: "#F2780E",
    logo: "/images/chainmovelogo.png",
  },
}

export function shortenWalletAddress(address: string) {
  if (address.length < 13) return address
  return `${address.slice(0, 6)}...${address.slice(-4)}`
}

function buildDisplay(config: WalletModeConfig, address: string): PublicWalletDisplay {
  const normalizedAddress = address.trim()
  const explorerBaseUrl = config.network.explorerAddressBaseUrl.replace(/\/$/, "")

  return {
    mode: config.mode,
    label: config.label,
    addressLabel: config.addressLabel,
    address: normalizedAddress,
    shortAddress: shortenWalletAddress(normalizedAddress),
    networkLabel: config.network.label,
    explorerUrl: `${explorerBaseUrl}/${encodeURIComponent(normalizedAddress)}`,
    linked: true,
  }
}

export function getWalletDisplay(input: WalletDisplayInput): PublicWalletDisplay {
  if (input.stellarPublicKey?.trim()) {
    return buildDisplay(PLANNED_STELLAR_WALLET, input.stellarPublicKey)
  }

  if (input.embeddedWalletAddress?.trim()) {
    return buildDisplay(CURRENT_EMBEDDED_WALLET, input.embeddedWalletAddress)
  }

  return {
    mode: null,
    label: "Wallet",
    addressLabel: "Wallet",
    address: null,
    shortAddress: null,
    networkLabel: "No network",
    explorerUrl: null,
    linked: false,
  }
}
