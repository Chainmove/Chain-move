import { describe, it, expect, vi, beforeEach } from "vitest"
import * as stellarConfig from "@/lib/stellar/config"
import { buildEnvelope, computeEnvelopeHash, assertEnvelopeFresh, EnvelopeValidationError, getNetworkPassphrase } from "@/lib/custody/envelope"

vi.mock("@/lib/stellar/config")

const TESTNET_CONFIG = {
  network: "testnet" as const,
  horizonUrl: "https://horizon-testnet.stellar.org",
  rpcUrl: "https://soroban-testnet.stellar.org",
  assetCode: "CMOVE",
  issuerPublicKey: "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H",
  distributionPublicKey: "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA",
  contractId: "",
  mock: true,
}

const SOURCE_ACCOUNT = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H"
const DESTINATION = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA"

function baseInput(overrides: Partial<Parameters<typeof buildEnvelope>[0]> = {}) {
  return {
    sourceAccount: SOURCE_ACCOUNT,
    sequence: "100",
    minTime: new Date("2026-01-01T00:00:00.000Z"),
    maxTime: new Date("2026-01-01T00:15:00.000Z"),
    intent: {
      category: "payout" as const,
      operation: "distribution.payment",
      params: { destination: DESTINATION, assetCode: "native", amount: "10.0000000" },
    },
    ...overrides,
  }
}

describe("buildEnvelope", () => {
  beforeEach(() => {
    vi.mocked(stellarConfig.getStellarConfig).mockReturnValue(TESTNET_CONFIG)
  })

  it("binds network, source, sequence, time bounds, memo, and intent", () => {
    const envelope = buildEnvelope(baseInput())
    expect(envelope.network).toBe("testnet")
    expect(envelope.networkPassphrase).toBe(getNetworkPassphrase("testnet"))
    expect(envelope.sourceAccount).toBe(SOURCE_ACCOUNT)
    expect(envelope.sequence).toBe("100")
    expect(envelope.memo).toEqual({ type: "none" })
    expect(envelope.intent.operation).toBe("distribution.payment")
  })

  it("rejects an invalid source account", () => {
    expect(() => buildEnvelope(baseInput({ sourceAccount: "not-a-key" }))).toThrow(EnvelopeValidationError)
  })

  it("rejects a non-numeric sequence", () => {
    expect(() => buildEnvelope(baseInput({ sequence: "abc" }))).toThrow(EnvelopeValidationError)
  })

  it("rejects maxTime at or before minTime", () => {
    expect(() =>
      buildEnvelope(baseInput({ minTime: new Date("2026-01-01T00:15:00.000Z"), maxTime: new Date("2026-01-01T00:15:00.000Z") })),
    ).toThrow(EnvelopeValidationError)
  })
})

describe("computeEnvelopeHash", () => {
  beforeEach(() => {
    vi.mocked(stellarConfig.getStellarConfig).mockReturnValue(TESTNET_CONFIG)
  })

  it("is deterministic for identical envelopes", () => {
    const envelope = buildEnvelope(baseInput())
    expect(computeEnvelopeHash(envelope)).toBe(computeEnvelopeHash(buildEnvelope(baseInput())))
  })

  it("changes when the intent (cross-intent) changes", () => {
    const envelope = buildEnvelope(baseInput())
    const differentIntent = buildEnvelope(
      baseInput({ intent: { category: "payout", operation: "distribution.payment", params: { destination: DESTINATION, assetCode: "native", amount: "20.0000000" } } }),
    )
    expect(computeEnvelopeHash(envelope)).not.toBe(computeEnvelopeHash(differentIntent))
  })

  it("changes when the sequence changes", () => {
    const envelope = buildEnvelope(baseInput())
    const differentSequence = buildEnvelope(baseInput({ sequence: "101" }))
    expect(computeEnvelopeHash(envelope)).not.toBe(computeEnvelopeHash(differentSequence))
  })
})

describe("assertEnvelopeFresh", () => {
  beforeEach(() => {
    vi.mocked(stellarConfig.getStellarConfig).mockReturnValue(TESTNET_CONFIG)
  })

  const now = new Date("2026-01-01T00:05:00.000Z")

  it("accepts a fresh envelope within its time bounds and above the watermark", () => {
    const envelope = buildEnvelope(baseInput())
    expect(() => assertEnvelopeFresh({ envelope, now, lastConsumedSequence: "99" })).not.toThrow()
  })

  it("rejects cross-network replay when the configured network differs", () => {
    const envelope = buildEnvelope(baseInput())
    vi.mocked(stellarConfig.getStellarConfig).mockReturnValue({ ...TESTNET_CONFIG, network: "mainnet" })
    expect(() => assertEnvelopeFresh({ envelope, now })).toThrow(/Cross-network replay/)
  })

  it("rejects a stale/replayed sequence", () => {
    const envelope = buildEnvelope(baseInput({ sequence: "100" }))
    expect(() => assertEnvelopeFresh({ envelope, now, lastConsumedSequence: "100" })).toThrow(/Stale sequence rejected/)
    expect(() => assertEnvelopeFresh({ envelope, now, lastConsumedSequence: "150" })).toThrow(/Stale sequence rejected/)
  })

  it("rejects an expired envelope (past maxTime) - replay-by-delay fails", () => {
    const envelope = buildEnvelope(baseInput())
    expect(() => assertEnvelopeFresh({ envelope, now: new Date("2026-01-01T01:00:00.000Z") })).toThrow(/expired/)
  })

  it("rejects an envelope not yet valid (before minTime)", () => {
    const envelope = buildEnvelope(baseInput())
    expect(() => assertEnvelopeFresh({ envelope, now: new Date("2025-12-31T23:00:00.000Z") })).toThrow(/not yet valid/)
  })
})
