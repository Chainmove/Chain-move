import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { getStellarConfig, parseStellarNetwork } from "./config"

describe("getStellarConfig", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clear out related env vars to test defaults and ensure test isolation
    const keysToRemove = [
      "STELLAR_NETWORK",
      "STELLAR_HORIZON_URL",
      "STELLAR_RPC_URL",
      "RPC_URL",
      "STELLAR_ASSET_CODE",
      "STELLAR_ISSUER_PUBLIC_KEY",
      "STELLAR_DISTRIBUTION_PUBLIC_KEY",
      "STELLAR_CONTRACT_ID",
      "STELLAR_EXPLORER_BASE_URL",
      "NEXT_PUBLIC_STELLAR_DEMO_PUBLIC_KEY",
      "STELLAR_DEMO_PUBLIC_KEY",
      "CHAINMOVE_CA",
      "ENABLE_MOCK_STELLAR",
    ]
    keysToRemove.forEach((key) => {
      delete process.env[key]
    })
  })

import { getStellarConfig } from "./config"

const VALID_PUBLIC_KEY = "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H"
const VALID_CONTRACT_SHAPE = `C${"A".repeat(55)}`

describe("getStellarConfig", () => {
  it("lets mock mode use defaults without deployment identifiers", () => {
    expect(getStellarConfig({ ENABLE_MOCK_STELLAR: "true" })).toMatchObject({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      assetCode: "CMOVE",
      issuerPublicKey: "",
      distributionPublicKey: "",
      contractId: "",
      explorerBaseUrl: "https://stellar.expert/explorer/testnet",
      mock: false,
      demoPublicKey: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000000",
    })
  })

  it("should resolve mainnet defaults and custom environment overrides", () => {
    process.env.STELLAR_NETWORK = "mainnet"
    process.env.STELLAR_ASSET_CODE = "TEST"
    process.env.STELLAR_ISSUER_PUBLIC_KEY = "GD123..."
    process.env.STELLAR_DISTRIBUTION_PUBLIC_KEY = "GD456..."
    process.env.STELLAR_CONTRACT_ID = "C123..."

    const config = getStellarConfig()

    expect(config).toEqual({
      network: "mainnet",
      horizonUrl: "https://horizon.stellar.org",
      rpcUrl: "https://soroban-mainnet.stellar.org",
      assetCode: "TEST",
      issuerPublicKey: "GD123...",
      distributionPublicKey: "GD456...",
      contractId: "C123...",
      explorerBaseUrl: "https://stellar.expert/explorer/public",
      mock: false,
      demoPublicKey: "GABCDMOCKSTELLARPUBLICKEYTESTNET000000000000000000000000000000",
    })
  })

  it("should reject unsupported networks instead of falling back to testnet", () => {
    process.env.STELLAR_NETWORK = "futurenet"

    expect(() => getStellarConfig()).toThrow('Invalid Stellar network "futurenet". Expected "testnet" or "mainnet".')
    expect(() => parseStellarNetwork("futurenet")).toThrow(/Invalid Stellar network/)
  })

  it("should support RPC_URL and CHAINMOVE_CA fallbacks when STELLAR_ RPC/contract variables are missing", () => {
    process.env.RPC_URL = "https://fallback-rpc.stellar.org"
    process.env.CHAINMOVE_CA = "CC_FALLBACK_123"

    const config = getStellarConfig()

    expect(config.rpcUrl).toBe("https://fallback-rpc.stellar.org")
    expect(config.contractId).toBe("CC_FALLBACK_123")
  })

  it("returns configured testnet URLs for a valid live configuration", () => {
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

  it("rejects unsupported networks even in mock mode", () => {
    expect(() =>
      getStellarConfig({ STELLAR_NETWORK: "futurenet", ENABLE_MOCK_STELLAR: "true" }),
    ).toThrow('Unsupported STELLAR_NETWORK: "futurenet"')
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
