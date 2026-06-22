export type StellarNetwork = "testnet" | "mainnet"

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
  | "ENABLE_MOCK_STELLAR",
  string | undefined
>>

const NETWORK_DEFAULTS: Record<StellarNetwork, Pick<StellarConfig, "horizonUrl" | "rpcUrl" | "explorerBaseUrl">> = {
  testnet: {
    horizonUrl: "https://horizon-testnet.stellar.org",
    rpcUrl: "https://soroban-testnet.stellar.org",
    explorerBaseUrl: TESTNET_EXPLORER_BASE_URL,
  },
  mainnet: {
    horizonUrl: "https://horizon.stellar.org",
    rpcUrl: "https://soroban-mainnet.stellar.org",
    explorerBaseUrl: MAINNET_EXPLORER_BASE_URL,
  },
}

/**
 * Normalizes the deployment network to a supported Stellar network.
 *
 * Keeping this validation in the shared config layer means all server clients
 * select the same endpoints and fail fast instead of silently using Testnet.
 */
export function parseStellarNetwork(value: string | undefined): StellarNetwork {
  const network = value?.trim().toLowerCase() || "testnet"

  if (network === "testnet" || network === "mainnet") {
    return network
  }

  throw new Error(`Invalid Stellar network "${value}". Expected "testnet" or "mainnet".`)
}

export function getStellarConfig(): StellarConfig {
  const network = parseStellarNetwork(process.env.STELLAR_NETWORK)
  const defaults = NETWORK_DEFAULTS[network]
  const mock = process.env.ENABLE_MOCK_STELLAR === "true"

  return {
    network,
    horizonUrl: process.env.STELLAR_HORIZON_URL || defaults.horizonUrl,
    rpcUrl: process.env.STELLAR_RPC_URL || process.env.RPC_URL || defaults.rpcUrl,
    assetCode: process.env.STELLAR_ASSET_CODE || "CMOVE",
    issuerPublicKey: process.env.STELLAR_ISSUER_PUBLIC_KEY || "",
    distributionPublicKey: process.env.STELLAR_DISTRIBUTION_PUBLIC_KEY || "",
    contractId: process.env.STELLAR_CONTRACT_ID || process.env.CHAINMOVE_CA || "",
    explorerBaseUrl: process.env.STELLAR_EXPLORER_BASE_URL || defaults.explorerBaseUrl,
    mock,
    demoPublicKey: process.env.NEXT_PUBLIC_STELLAR_DEMO_PUBLIC_KEY || process.env.STELLAR_DEMO_PUBLIC_KEY || FALLBACK_DEMO_PUBLIC_KEY,
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
 * Reads server-side Stellar configuration. This layer intentionally accepts only
 * public account identifiers and endpoints; private/secret keys never belong here.
 */
export function getStellarConfig(env: StellarEnvironment = process.env): StellarConfig {
  const network = parseNetwork(value(env, "STELLAR_NETWORK"))
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
