import { isValidStellarPublicKey } from "@/lib/validation/stellar"

export const STELLAR_NETWORKS = ["testnet", "mainnet"] as const

export type StellarNetwork = (typeof STELLAR_NETWORKS)[number]

export interface StellarConfig {
  network: StellarNetwork
  horizonUrl: string
  rpcUrl: string
  assetCode: string
  issuerPublicKey: string
  distributionPublicKey: string
  contractId: string
  mock: boolean
}

type StellarEnvironment = Partial<Record<
  | "STELLAR_NETWORK"
  | "STELLAR_HORIZON_URL"
  | "STELLAR_RPC_URL"
  | "STELLAR_ASSET_CODE"
  | "STELLAR_ISSUER_PUBLIC_KEY"
  | "STELLAR_DISTRIBUTION_PUBLIC_KEY"
  | "STELLAR_CONTRACT_ID"
  | "ENABLE_MOCK_STELLAR"
  | "NODE_ENV",
  string | undefined
>>

const NETWORK_DEFAULTS: Record<StellarNetwork, Pick<StellarConfig, "horizonUrl" | "rpcUrl">> = {
  testnet: {
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
  },
  mainnet: {
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: "https://soroban-mainnet.stellar.org",
  },
}

const REQUIRED_DEPLOYMENT_FIELDS = [
  "STELLAR_ISSUER_PUBLIC_KEY",
  "STELLAR_DISTRIBUTION_PUBLIC_KEY",
  "STELLAR_CONTRACT_ID",
] as const

function value(env: StellarEnvironment, name: keyof StellarEnvironment): string {
  return env[name]?.trim() ?? ""
}

function isPlaceholder(input: string): boolean {
  return input.toLowerCase().startsWith("replace_")
}

export function parseStellarNetwork(input: string | undefined): StellarNetwork {
  const network = input?.trim().toLowerCase() || "testnet"
  if (!STELLAR_NETWORKS.includes(network as StellarNetwork)) {
    throw new Error(`Unsupported STELLAR_NETWORK: "${input}". Supported values are testnet and mainnet.`)
  }
  return network as StellarNetwork
}

function validateUrl(name: string, input: string): void {
  try {
    const url = new URL(input)
    if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error()
  } catch {
    throw new Error(`Invalid ${name}: expected an HTTP(S) URL.`)
  }
}

function validateDeploymentConfig(config: StellarConfig): void {
  if (!isValidStellarPublicKey(config.issuerPublicKey)) {
    throw new Error("Invalid STELLAR_ISSUER_PUBLIC_KEY: expected a Stellar G... public key.")
  }
  if (!isValidStellarPublicKey(config.distributionPublicKey)) {
    throw new Error("Invalid STELLAR_DISTRIBUTION_PUBLIC_KEY: expected a Stellar G... public key.")
  }
  if (!/^C[A-Z2-7]{55}$/.test(config.contractId)) {
    throw new Error("Invalid STELLAR_CONTRACT_ID: expected a Stellar C... contract ID.")
  }
}

/**
 * Reads server-side Stellar configuration. Only public account identifiers
 * and endpoints belong here; private or secret keys must never be added.
 */
export function getStellarConfig(env: StellarEnvironment = process.env): StellarConfig {
  const network = parseStellarNetwork(value(env, "STELLAR_NETWORK"))
  const mock = value(env, "ENABLE_MOCK_STELLAR").toLowerCase() === "true"
  const defaults = NETWORK_DEFAULTS[network]

  if (!mock) {
    for (const field of REQUIRED_DEPLOYMENT_FIELDS) {
      const fieldValue = value(env, field)
      if (!fieldValue || isPlaceholder(fieldValue)) {
        throw new Error(`Missing required Stellar configuration: ${field}.`)
      }
    }
  }

  const config: StellarConfig = {
    network,
    horizonUrl: value(env, "STELLAR_HORIZON_URL") || defaults.horizonUrl,
    rpcUrl: value(env, "STELLAR_RPC_URL") || defaults.rpcUrl,
    assetCode: value(env, "STELLAR_ASSET_CODE") || "CMOVE",
    issuerPublicKey: value(env, "STELLAR_ISSUER_PUBLIC_KEY"),
    distributionPublicKey: value(env, "STELLAR_DISTRIBUTION_PUBLIC_KEY"),
    contractId: value(env, "STELLAR_CONTRACT_ID"),
    mock,
  }

  if (!mock) {
    validateUrl("STELLAR_HORIZON_URL", config.horizonUrl)
    validateUrl("STELLAR_RPC_URL", config.rpcUrl)
    validateDeploymentConfig(config)
  }

  return config
}
