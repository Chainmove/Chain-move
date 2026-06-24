export type StellarDisplayNetwork = "testnet" | "mainnet"

export interface StellarDisplayConfig {
  network: StellarDisplayNetwork
  explorerBaseUrl: string
  mock: boolean
  demoPublicKey: string
}

const FALLBACK_DEMO_PUBLIC_KEY = "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000000"

// Browser code receives display-only defaults. Server environment values from
// config.ts are deliberately excluded from this module and the frontend bundle.
export function getStellarDisplayConfig(): StellarDisplayConfig {
  return {
    network: "testnet",
    explorerBaseUrl: "https://stellar.expert/explorer/testnet",
    mock: process.env.NODE_ENV !== "production",
    demoPublicKey: FALLBACK_DEMO_PUBLIC_KEY,
  }
}

export function getStellarNetworkLabel(network: string): string {
  const normalized = network.trim().toLowerCase()
  if (!normalized) return "Stellar"
  return normalized.charAt(0).toUpperCase() + normalized.slice(1)
}

export function buildStellarReferenceUrl(
  reference: string,
  config: Pick<StellarDisplayConfig, "explorerBaseUrl"> = getStellarDisplayConfig(),
): string | null {
  const normalizedReference = reference.trim()
  if (!normalizedReference) return null
  return `${config.explorerBaseUrl.replace(/\/$/, "")}/tx/${encodeURIComponent(normalizedReference)}`
}
