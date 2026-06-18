export interface StellarConfig {
  network: string
  horizonUrl: string
  rpcUrl: string
  assetCode: string
  issuerPublicKey: string
  distributionPublicKey: string
  contractId: string
  explorerBaseUrl: string
  mock: boolean
  demoPublicKey: string
}

const TESTNET_EXPLORER_BASE_URL = "https://stellar.expert/explorer/testnet"
const MAINNET_EXPLORER_BASE_URL = "https://stellar.expert/explorer/public"
const FALLBACK_DEMO_PUBLIC_KEY = "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000000"

function getDefaultExplorerBaseUrl(network: string) {
  return network.toLowerCase() === "mainnet" ? MAINNET_EXPLORER_BASE_URL : TESTNET_EXPLORER_BASE_URL
}

export function getStellarConfig(): StellarConfig {
  const network = process.env.STELLAR_NETWORK || "testnet"
  const mock = process.env.ENABLE_MOCK_STELLAR ? process.env.ENABLE_MOCK_STELLAR === "true" : process.env.NODE_ENV !== "production"

  return {
    network,
    horizonUrl: process.env.STELLAR_HORIZON_URL || "https://horizon-testnet.stellar.org",
    rpcUrl: process.env.STELLAR_RPC_URL || process.env.RPC_URL || "https://soroban-testnet.stellar.org",
    assetCode: process.env.STELLAR_ASSET_CODE || "CMOVE",
    issuerPublicKey: process.env.STELLAR_ISSUER_PUBLIC_KEY || "",
    distributionPublicKey: process.env.STELLAR_DISTRIBUTION_PUBLIC_KEY || "",
    contractId: process.env.STELLAR_CONTRACT_ID || process.env.CHAINMOVE_CA || "",
    explorerBaseUrl: process.env.STELLAR_EXPLORER_BASE_URL || getDefaultExplorerBaseUrl(network),
    mock,
    demoPublicKey: process.env.NEXT_PUBLIC_STELLAR_DEMO_PUBLIC_KEY || process.env.STELLAR_DEMO_PUBLIC_KEY || FALLBACK_DEMO_PUBLIC_KEY,
  }
}

export function getStellarNetworkLabel(network: string) {
  const normalized = network.trim().toLowerCase()
  if (!normalized) return "Stellar"
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function buildStellarReferenceUrl(reference: string, config = getStellarConfig()) {
  const normalizedReference = reference.trim()
  if (!normalizedReference) return null

  const baseUrl = config.explorerBaseUrl.replace(/\/$/, "")
  return `${baseUrl}/tx/${encodeURIComponent(normalizedReference)}`
}
