import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("server-only", () => ({}))

import { getHorizonServer, getSorobanRpcServer, getStellarClient, getStellarNetworkPassphrase } from "./client"

describe("Stellar client helpers", () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    delete process.env.STELLAR_NETWORK
    delete process.env.STELLAR_HORIZON_URL
    delete process.env.STELLAR_RPC_URL
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it("creates Horizon and Soroban RPC clients for the default testnet configuration", () => {
    const client = getStellarClient()

    expect(client.config.network).toBe("testnet")
    expect(client.horizon.serverURL.toString()).toBe("https://horizon-testnet.stellar.org/")
    expect(client.sorobanRpc.serverURL.toString()).toBe("https://soroban-testnet.stellar.org/")
    expect(client.networkPassphrase).toBe("Test SDF Network ; September 2015")
  })

  it("creates Horizon and Soroban RPC clients for mainnet", () => {
    process.env.STELLAR_NETWORK = "mainnet"

    expect(getHorizonServer().serverURL.toString()).toBe("https://horizon.stellar.org/")
    expect(getSorobanRpcServer().serverURL.toString()).toBe("https://soroban-mainnet.stellar.org/")
    expect(getStellarNetworkPassphrase()).toBe("Public Global Stellar Network ; September 2015")
  })

  it("rejects invalid network selections", () => {
    process.env.STELLAR_NETWORK = "futurenet"

    expect(() => getStellarClient()).toThrow(/Invalid Stellar network/)
  })
})
