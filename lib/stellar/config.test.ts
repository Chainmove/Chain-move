import { describe, expect, it, beforeEach, afterEach } from "vitest"
import { getStellarConfig } from "./config"

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
      "CHAINMOVE_CA",
      "ENABLE_MOCK_STELLAR",
    ]
    keysToRemove.forEach((key) => {
      delete process.env[key]
    })
  })

  afterEach(() => {
    // Restore original env vars after each test
    process.env = { ...originalEnv }
  })

  it("should return default testnet configuration when no env override is present", () => {
    const config = getStellarConfig()

    expect(config).toEqual({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      assetCode: "CMOVE",
      issuerPublicKey: "",
      distributionPublicKey: "",
      contractId: "",
      mock: false,
    })
  })

  it("should return configuration with custom environment overrides", () => {
    process.env.STELLAR_NETWORK = "mainnet"
    process.env.STELLAR_HORIZON_URL = "https://horizon.stellar.org"
    process.env.STELLAR_RPC_URL = "https://soroban-mainnet.stellar.org"
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
      mock: false,
    })
  })

  it("should support RPC_URL and CHAINMOVE_CA fallbacks when STELLAR_ RPC/contract variables are missing", () => {
    process.env.RPC_URL = "https://fallback-rpc.stellar.org"
    process.env.CHAINMOVE_CA = "CC_FALLBACK_123"

    const config = getStellarConfig()

    expect(config.rpcUrl).toBe("https://fallback-rpc.stellar.org")
    expect(config.contractId).toBe("CC_FALLBACK_123")
  })

  it("should prioritize STELLAR_ environment variables over their fallback counterparts", () => {
    process.env.STELLAR_RPC_URL = "https://stellar-rpc.org"
    process.env.RPC_URL = "https://fallback-rpc.org"
    
    process.env.STELLAR_CONTRACT_ID = "C_STELLAR_1"
    process.env.CHAINMOVE_CA = "C_FALLBACK_1"

    const config = getStellarConfig()

    expect(config.rpcUrl).toBe("https://stellar-rpc.org")
    expect(config.contractId).toBe("C_STELLAR_1")
  })

  it("should support mock mode when ENABLE_MOCK_STELLAR is 'true'", () => {
    process.env.ENABLE_MOCK_STELLAR = "true"
    expect(getStellarConfig().mock).toBe(true)
  })

  it("should not enable mock mode when ENABLE_MOCK_STELLAR is not 'true'", () => {
    process.env.ENABLE_MOCK_STELLAR = "false"
    expect(getStellarConfig().mock).toBe(false)

    delete process.env.ENABLE_MOCK_STELLAR
    expect(getStellarConfig().mock).toBe(false)
  })
})
