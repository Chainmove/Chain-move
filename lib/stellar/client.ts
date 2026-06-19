import { getStellarConfig } from "@/lib/stellar/config"

export type StellarNetwork = "testnet" | "mainnet"

export interface StellarClientConfig {
  network: StellarNetwork
  horizonUrl: string
  rpcUrl: string
  networkPassphrase: string
}

export interface StellarClientEndpoints {
  config: StellarClientConfig
  horizon: {
    baseUrl: string
    buildUrl: (path: string) => string
  }
  soroban: {
    rpcUrl: string
    buildJsonRpcRequest: (method: string, params?: unknown) => {
      jsonrpc: "2.0"
      id: string
      method: string
      params?: unknown
    }
  }
}

const NETWORK_DEFAULTS: Record<
  StellarNetwork,
  { horizonUrl: string; rpcUrl: string; networkPassphrase: string }
> = {
  testnet: {
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    networkPassphrase: "Test SDF Network ; September 2015",
  },
  mainnet: {
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: "https://soroban-mainnet.stellar.org",
    networkPassphrase: "Public Global Stellar Network ; September 2015",
  },
}

export function normalizeStellarNetwork(network?: string): StellarNetwork {
  const normalized = (network || "testnet").trim().toLowerCase()

  if (normalized === "testnet") return "testnet"
  if (normalized === "mainnet" || normalized === "public") return "mainnet"

  throw new Error(
    `Unsupported Stellar network "${network}". Use "testnet" or "mainnet".`,
  )
}

export function getStellarClientConfig(
  network = getStellarConfig().network,
): StellarClientConfig {
  assertServerOnly()

  const selectedNetwork = normalizeStellarNetwork(network)
  const defaults = NETWORK_DEFAULTS[selectedNetwork]

  return {
    network: selectedNetwork,
    horizonUrl: (
      process.env.STELLAR_HORIZON_URL || defaults.horizonUrl
    ).replace(/\/$/, ""),
    rpcUrl: (
      process.env.STELLAR_RPC_URL ||
      process.env.RPC_URL ||
      defaults.rpcUrl
    ).replace(/\/$/, ""),
    networkPassphrase: defaults.networkPassphrase,
  }
}

export function createStellarClients(network?: string): StellarClientEndpoints {
  const config = getStellarClientConfig(network)

  return {
    config,
    horizon: {
      baseUrl: config.horizonUrl,
      buildUrl: (path: string) => {
        const normalizedPath = path.startsWith("/") ? path : `/${path}`
        return `${config.horizonUrl}${normalizedPath}`
      },
    },
    soroban: {
      rpcUrl: config.rpcUrl,
      buildJsonRpcRequest: (method: string, params?: unknown) => ({
        jsonrpc: "2.0",
        id: `${method}-${Date.now()}`,
        method,
        ...(params === undefined ? {} : { params }),
      }),
    },
  }
}

function assertServerOnly() {
  if (typeof window !== "undefined") {
    throw new Error("Stellar client helpers are server-only.")
  }
}
