export type WalletNetwork = "stellar-testnet" | "stellar-mainnet" | "lisk-sepolia" | "unknown"

export type WalletType = "embedded" | "stellar" | "evm" | "unknown"

export interface BlockchainAccount {
  publicKey: string
  accountId?: string
  network: WalletNetwork
  type: WalletType
  address?: string
  linked: boolean
}

export interface WalletIdentity {
  userId: string
  privyUserId?: string | null
  email?: string | null
  phoneNumber?: string | null
  name?: string
  fullName?: string
}

export interface WalletMetadata {
  network: WalletNetwork
  networkLabel: string
  explorerBaseUrl?: string
  isTestnet: boolean
}

export interface WalletState {
  identity: WalletIdentity | null
  accounts: BlockchainAccount[]
  primaryAccount: BlockchainAccount | null
  metadata: WalletMetadata
  isReady: boolean
}

export function getNetworkMetadata(network: WalletNetwork): WalletMetadata {
  switch (network) {
    case "stellar-testnet":
      return {
        network: "stellar-testnet",
        networkLabel: "Stellar Testnet",
        explorerBaseUrl: "https://stellar.expert/explorer/testnet",
        isTestnet: true,
      }
    case "stellar-mainnet":
      return {
        network: "stellar-mainnet",
        networkLabel: "Stellar Mainnet",
        explorerBaseUrl: "https://stellar.expert/explorer/public",
        isTestnet: false,
      }
    case "lisk-sepolia":
      return {
        network: "lisk-sepolia",
        networkLabel: "Lisk Sepolia",
        explorerBaseUrl: "https://sepolia-blockscout.lisk.com",
        isTestnet: true,
      }
    default:
      return {
        network: "unknown",
        networkLabel: "Unknown Network",
        isTestnet: true,
      }
  }
}

export function createEmptyWalletState(network: WalletNetwork = "stellar-testnet"): WalletState {
  return {
    identity: null,
    accounts: [],
    primaryAccount: null,
    metadata: getNetworkMetadata(network),
    isReady: false,
  }
}

export function isStellarAccount(account: BlockchainAccount | null): boolean {
  if (!account) return false
  return account.network === "stellar-testnet" || account.network === "stellar-mainnet"
}

export function isEvmAccount(account: BlockchainAccount | null): boolean {
  if (!account) return false
  return account.network === "lisk-sepolia" || account.type === "evm"
}

export function getPrimaryAccountAddress(state: WalletState): string | null {
  if (!state.primaryAccount) return null
  return state.primaryAccount.publicKey || state.primaryAccount.address || null
}
