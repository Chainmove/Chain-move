import type { BlockchainAccount, WalletNetwork, WalletType } from "@/types/wallet"

export interface WalletAdapter {
  type: WalletType
  supportsNetwork: (network: WalletNetwork) => boolean
  getAccount: () => Promise<BlockchainAccount | null>
  isAvailable: () => boolean
}

export class StellarWalletAdapter implements WalletAdapter {
  readonly type: WalletType = "stellar"

  supportsNetwork(network: WalletNetwork): boolean {
    return network === "stellar-testnet" || network === "stellar-mainnet"
  }

  async getAccount(): Promise<BlockchainAccount | null> {
    return null
  }

  isAvailable(): boolean {
    return false
  }
}

export class EmbeddedWalletAdapter implements WalletAdapter {
  readonly type: WalletType = "embedded"

  private walletAddress: string | null

  constructor(walletAddress: string | null = null) {
    this.walletAddress = walletAddress
  }

  supportsNetwork(network: WalletNetwork): boolean {
    return network === "lisk-sepolia"
  }

  async getAccount(): Promise<BlockchainAccount | null> {
    if (!this.walletAddress) return null

    return {
      publicKey: this.walletAddress.toLowerCase(),
      address: this.walletAddress.toLowerCase(),
      network: "lisk-sepolia",
      type: "embedded",
      linked: true,
    }
  }

  isAvailable(): boolean {
    return this.walletAddress !== null
  }

  setWalletAddress(address: string | null) {
    this.walletAddress = address
  }
}

export class EvmWalletAdapter implements WalletAdapter {
  readonly type: WalletType = "evm"

  private walletAddress: string | null

  constructor(walletAddress: string | null = null) {
    this.walletAddress = walletAddress
  }

  supportsNetwork(network: WalletNetwork): boolean {
    return network === "lisk-sepolia"
  }

  async getAccount(): Promise<BlockchainAccount | null> {
    if (!this.walletAddress) return null

    return {
      publicKey: this.walletAddress.toLowerCase(),
      address: this.walletAddress.toLowerCase(),
      network: "lisk-sepolia",
      type: "evm",
      linked: true,
    }
  }

  isAvailable(): boolean {
    return this.walletAddress !== null
  }
}

export function createWalletAdapters(config: {
  embeddedWalletAddress?: string | null
  stellarPublicKey?: string | null
  evmWalletAddress?: string | null
}): WalletAdapter[] {
  const adapters: WalletAdapter[] = []

  if (config.stellarPublicKey) {
    adapters.push(new StellarWalletAdapter())
  }

  if (config.embeddedWalletAddress) {
    adapters.push(new EmbeddedWalletAdapter(config.embeddedWalletAddress))
  }

  if (config.evmWalletAddress) {
    adapters.push(new EvmWalletAdapter(config.evmWalletAddress))
  }

  return adapters
}
