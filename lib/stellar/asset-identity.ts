import type { StellarConfig } from "@/lib/stellar/config"

export interface AssetIdentity {
  asset: string
  issuer: string | null
  verified: boolean
  /** Globally unique identifier: "<CODE>:<ISSUER>" or "XLM:native" */
  canonicalId: string
}

export const XLM_CANONICAL_ID = "XLM:native"

/**
 * Returns the canonical identity of a Stellar asset, flagging it as verified
 * only when its issuer matches the configured canonical issuer.
 *
 * On Stellar, asset identity is the (code, issuer) pair — identifying assets
 * by code alone enables token spoofing (e.g. an attacker-minted "CMOVE" token
 * from a different issuer would appear indistinguishable from the real one).
 */
export function classifyAsset(
  assetCode: string | null | undefined,
  assetIssuer: string | null | undefined,
  config: Pick<StellarConfig, "assetCode" | "issuerPublicKey">,
): AssetIdentity {
  if (!assetCode || assetCode.toUpperCase() === "XLM") {
    return {
      asset: "XLM",
      issuer: null,
      verified: true,
      canonicalId: XLM_CANONICAL_ID,
    }
  }

  const code = assetCode.toUpperCase()
  const issuer = assetIssuer ?? null
  const canonicalCode = config.assetCode?.toUpperCase() ?? ""

  const verified =
    code === canonicalCode &&
    !!issuer &&
    !!config.issuerPublicKey &&
    issuer === config.issuerPublicKey

  return {
    asset: code,
    issuer,
    verified,
    canonicalId: issuer ? `${code}:${issuer}` : `${code}:unknown`,
  }
}
