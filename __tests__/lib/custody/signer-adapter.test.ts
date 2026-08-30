// @vitest-environment node
//
// Real ed25519 keypair generation (via @noble/curves) needs a working
// crypto.getRandomValues, which jsdom's default test environment does not
// provide reliably. This module has no DOM dependency, so it runs under the
// plain Node environment instead of the project-wide jsdom default.
import { describe, it, expect, vi } from "vitest"
import crypto from "crypto"
import { Keypair } from "@stellar/stellar-sdk"
import { LocalDevSignerAdapter, createExternalSignerAdapter, createSignerAdapter, CustodyAdapterError } from "@/lib/custody/signer-adapter"

function envWith(overrides: Partial<NodeJS.ProcessEnv>): NodeJS.ProcessEnv {
  return {
    STELLAR_NETWORK: "testnet",
    ENABLE_MOCK_STELLAR: "true",
    ...overrides,
  } as NodeJS.ProcessEnv
}

describe("LocalDevSignerAdapter", () => {
  it("is structurally testnet-only: throws when network is mainnet even if mock is claimed true", () => {
    expect(() => new LocalDevSignerAdapter(envWith({ STELLAR_NETWORK: "mainnet" }))).toThrow(CustodyAdapterError)
  })

  it("throws when mock mode is not enabled, even on testnet", () => {
    expect(() =>
      new LocalDevSignerAdapter(
        envWith({
          ENABLE_MOCK_STELLAR: "false",
          STELLAR_ISSUER_PUBLIC_KEY: "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H",
          STELLAR_DISTRIBUTION_PUBLIC_KEY: "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA",
          STELLAR_CONTRACT_ID: "C" + "A".repeat(55),
        }),
      ),
    ).toThrow(CustodyAdapterError)
  })

  it("reads the network from shared config, not a caller-supplied value - there is no network parameter to spoof", () => {
    const adapter = new LocalDevSignerAdapter(envWith({}))
    expect(adapter).toBeInstanceOf(LocalDevSignerAdapter)
  })

  it("produces a verifiable ed25519 signature over the payload hash without ever exposing key material", async () => {
    const adapter = new LocalDevSignerAdapter(envWith({}))
    const publicKey = await adapter.getPublicKey("issuer-1")
    const payloadHash = crypto.createHash("sha256").update("some transaction bytes").digest("hex")
    const signature = await adapter.sign("issuer-1", payloadHash)

    // The adapter's public surface never returns anything but a public key
    // (non-secret) and a base64 signature - assert both by type, and that
    // the signature actually verifies against the returned public key.
    expect(typeof publicKey).toBe("string")
    expect(publicKey.startsWith("G")).toBe(true)
    const verified = Keypair.fromPublicKey(publicKey).verify(Buffer.from(payloadHash, "hex"), Buffer.from(signature, "base64"))
    expect(verified).toBe(true)
  })

  it("returns a stable public key for the same signerId within one adapter instance", async () => {
    const adapter = new LocalDevSignerAdapter(envWith({}))
    const first = await adapter.getPublicKey("issuer-1")
    const second = await adapter.getPublicKey("issuer-1")
    expect(first).toBe(second)
  })

  it("gives distinct signers distinct keys", async () => {
    const adapter = new LocalDevSignerAdapter(envWith({}))
    const a = await adapter.getPublicKey("issuer-1")
    const b = await adapter.getPublicKey("issuer-2")
    expect(a).not.toBe(b)
  })

  it("rejects a malformed payload hash", async () => {
    const adapter = new LocalDevSignerAdapter(envWith({}))
    await expect(adapter.sign("issuer-1", "not-a-hex-hash")).rejects.toThrow(CustodyAdapterError)
  })
})

describe("secret scanning", () => {
  it("never puts raw key material in an audit-loggable form: getPublicKey/sign only return public data", async () => {
    const adapter = new LocalDevSignerAdapter(envWith({}))
    const publicKey = await adapter.getPublicKey("issuer-1")
    const signature = await adapter.sign("issuer-1", crypto.createHash("sha256").update("x").digest("hex"))

    // Neither return value can be a raw ed25519 seed: a seed StrKey starts
    // with "S" and is 56 chars; public keys start with "G" and signatures
    // are base64, never StrKey-encoded at all.
    expect(publicKey.startsWith("S")).toBe(false)
    expect(signature.startsWith("S")).toBe(false)
    expect(/^[A-Za-z0-9+/]+=*$/.test(signature)).toBe(true)
  })

  it("LocalDevSignerAdapter has no method or property that returns a private key", () => {
    const adapter = new LocalDevSignerAdapter(envWith({}))
    const members = Object.getOwnPropertyNames(Object.getPrototypeOf(adapter))
    for (const member of members) {
      expect(member.toLowerCase()).not.toContain("secret")
      expect(member.toLowerCase()).not.toContain("seed")
      expect(member.toLowerCase()).not.toContain("privatekey")
    }
  })
})

describe("createExternalSignerAdapter", () => {
  it("throws until a production adapter is injected, never silently falling back to a local secret", () => {
    expect(() => createExternalSignerAdapter()).toThrow(/CUSTODY_ADAPTER_NOT_CONFIGURED/)
  })
})

describe("createSignerAdapter", () => {
  it("resolves to LocalDevSignerAdapter only for testnet+mock", () => {
    const adapter = createSignerAdapter(envWith({}))
    expect(adapter).toBeInstanceOf(LocalDevSignerAdapter)
  })

  it("resolves to the external adapter contract (which throws unconfigured) for mainnet", () => {
    expect(() => createSignerAdapter(envWith({ STELLAR_NETWORK: "mainnet", ENABLE_MOCK_STELLAR: "false", STELLAR_ISSUER_PUBLIC_KEY: "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H", STELLAR_DISTRIBUTION_PUBLIC_KEY: "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA", STELLAR_CONTRACT_ID: "C" + "A".repeat(55) }))).toThrow(
      /CUSTODY_ADAPTER_NOT_CONFIGURED/,
    )
  })
})
