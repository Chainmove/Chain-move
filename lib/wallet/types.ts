import type { PrivyClientConfig } from "@privy-io/react-auth"

export type WalletMode = "embedded-evm" | "stellar-account"
export type WalletChainFamily = "evm" | "stellar"

export interface WalletNetworkConfig {
  id: string
  label: string
  family: WalletChainFamily
  nativeAsset: string
  explorerAddressBaseUrl: string
  rpcUrl?: string
}

export interface WalletModeConfig {
  mode: WalletMode
  label: string
  addressLabel: string
  network: WalletNetworkConfig
  provider: "privy" | "stellar"
  status: "current" | "planned"
}

export interface WalletDisplayInput {
  embeddedWalletAddress?: string | null
  stellarPublicKey?: string | null
}

export interface PublicWalletDisplay {
  mode: WalletMode | null
  label: string
  addressLabel: string
  address: string | null
  shortAddress: string | null
  networkLabel: string
  explorerUrl: string | null
  linked: boolean
}

export type EmbeddedWalletProviderConfig = PrivyClientConfig
