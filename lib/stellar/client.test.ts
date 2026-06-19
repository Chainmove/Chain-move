// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  createStellarClients,
  getStellarClientConfig,
  normalizeStellarNetwork,
} from "./client"

describe("stellar client helper", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date("2026-06-20T00:00:00Z"))
    delete process.env.STELLAR_NETWORK
    delete process.env.STELLAR_HORIZON_URL
    delete process.env.STELLAR_RPC_URL
    delete process.env.RPC_URL
  })

  afterEach(() => {
    vi.useRealTimers()
    process.env = { ...originalEnv }
  })

  it("defaults to testnet Horizon and Soroban RPC endpoints", () => {
    const config = getStellarClientConfig()

    expect(config).toEqual({
      network: "testnet",
      horizonUrl: "https://horizon-testnet.stellar.org",
      rpcUrl: "https://soroban-testnet.stellar.org",
      networkPassphrase: "Test SDF Network ; September 2015",
    })
  })

  it("supports mainnet selection without requiring env URL overrides", () => {
    const config = getStellarClientConfig("mainnet")

    expect(config).toEqual({
      network: "mainnet",
      horizonUrl: "https://horizon.stellar.org",
      rpcUrl: "https://soroban-mainnet.stellar.org",
      networkPassphrase: "Public Global Stellar Network ; September 2015",
    })
  })

  it("uses the Stellar config helper network by default", () => {
    process.env.STELLAR_NETWORK = "mainnet"

    expect(getStellarClientConfig().network).toBe("mainnet")
  })

  it("keeps explicit Horizon and RPC env overrides", () => {
    process.env.STELLAR_HORIZON_URL = "https://horizon.example.org/"
    process.env.STELLAR_RPC_URL = "https://rpc.example.org/"

    const config = getStellarClientConfig("testnet")

    expect(config.horizonUrl).toBe("https://horizon.example.org")
    expect(config.rpcUrl).toBe("https://rpc.example.org")
  })

  it("rejects unsupported network names", () => {
    expect(() => normalizeStellarNetwork("devnet")).toThrow(
      /Unsupported Stellar network/,
    )
  })

  it("builds Horizon URLs and Soroban JSON-RPC requests from one config", () => {
    const clients = createStellarClients("testnet")

    expect(clients.horizon.buildUrl("/accounts/GABC")).toBe(
      "https://horizon-testnet.stellar.org/accounts/GABC",
    )
    expect(clients.soroban.buildJsonRpcRequest("getHealth")).toEqual({
      jsonrpc: "2.0",
      id: "getHealth-1781913600000",
      method: "getHealth",
    })
    expect(clients.config.network).toBe("testnet")
  })
})
