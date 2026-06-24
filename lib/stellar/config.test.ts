import { describe, expect, it } from "vitest"

import { getStellarConfig, parseStellarNetwork } from "./config"

const VALID_PUBLIC_KEY = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"
const VALID_CONTRACT_SHAPE = `C${"A".repeat(55)}`

describe("getStellarConfig", () => {
  it("lets mock mode use testnet defaults without deployment identifiers", () => {
    expect(getStellarConfig({ ENABLE_MOCK_STELLAR: "true" })).toEqual({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      assetCode: "CMOVE",
      issuerPublicKey: "",
      distributionPublicKey: "",
      contractId: "",
      mock: true,
    })
  })

  it("names a missing required field when mock mode is disabled", () => {
    expect(() => getStellarConfig({ ENABLE_MOCK_STELLAR: "false" })).toThrow(
      "Missing required Stellar configuration: STELLAR_ISSUER_PUBLIC_KEY",
    )
  })

  it("returns configured URLs for a valid live configuration", () => {
    const config = getStellarConfig({
      STELLAR_NETWORK: "testnet",
      STELLAR_HORIZON_URL: "https://example.com/horizon",
      STELLAR_RPC_URL: "https://example.com/rpc",
      STELLAR_ISSUER_PUBLIC_KEY: VALID_PUBLIC_KEY,
      STELLAR_DISTRIBUTION_PUBLIC_KEY: VALID_PUBLIC_KEY,
      STELLAR_CONTRACT_ID: VALID_CONTRACT_SHAPE,
      ENABLE_MOCK_STELLAR: "false",
    })

    expect(config.horizonUrl).toBe("https://example.com/horizon")
    expect(config.rpcUrl).toBe("https://example.com/rpc")
  })

  it("selects mainnet endpoint defaults", () => {
    const config = getStellarConfig({
      STELLAR_NETWORK: "mainnet",
      ENABLE_MOCK_STELLAR: "true",
    })

    expect(config.horizonUrl).toBe("https://horizon.stellar.org")
    expect(config.rpcUrl).toBe("https://soroban-mainnet.stellar.org")
  })

  it("rejects unsupported networks even in mock mode", () => {
    expect(() =>
      getStellarConfig({ STELLAR_NETWORK: "futurenet", ENABLE_MOCK_STELLAR: "true" }),
    ).toThrow('Unsupported STELLAR_NETWORK: "futurenet"')
    expect(() => parseStellarNetwork("futurenet")).toThrow(/Unsupported STELLAR_NETWORK/)
  })

  it("allows placeholders only in mock mode", () => {
    const placeholders = {
      STELLAR_ISSUER_PUBLIC_KEY: "replace_with_public_key",
      STELLAR_DISTRIBUTION_PUBLIC_KEY: "replace_with_public_key",
      STELLAR_CONTRACT_ID: "replace_after_deployment",
    }

    expect(getStellarConfig({ ...placeholders, ENABLE_MOCK_STELLAR: "true" }).mock).toBe(true)
    expect(() => getStellarConfig({ ...placeholders, ENABLE_MOCK_STELLAR: "false" })).toThrow(
      "STELLAR_ISSUER_PUBLIC_KEY",
    )
  })
})
