import { describe, it, expect } from "vitest"
import {
  DEFAULT_THRESHOLD_POLICIES,
  getThresholdPolicy,
  validateSignerSetInvariants,
  assertPayoutWithinPolicy,
  SignerSetInvariantError,
  PolicyViolationError,
} from "@/lib/custody/policy"
import type { SignerDescriptor } from "@/lib/custody/types"

const KEY_A = "GAAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQDZ7H"
const KEY_B = "GABAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEAQCAIBAEJXA"
const KEY_C = "GBRLHRADGGA2RPHJ3AVHOTIT3GENGHQETXTHOHY4IUJJLI26KHWQBD6U"

describe("threshold matrices", () => {
  it("defines a policy for every operation category with a sane threshold/signer floor", () => {
    for (const category of Object.keys(DEFAULT_THRESHOLD_POLICIES) as Array<keyof typeof DEFAULT_THRESHOLD_POLICIES>) {
      const policy = getThresholdPolicy(category)
      expect(policy.minThreshold).toBeGreaterThan(0)
      expect(policy.minSigners).toBeGreaterThanOrEqual(policy.minThreshold)
      expect(policy.eligibleRoles.length).toBeGreaterThan(0)
    }
  })

  it("requires issuance to be at least 2-of-N (mirrors issuer cold multisig)", () => {
    expect(getThresholdPolicy("issuance").minThreshold).toBeGreaterThanOrEqual(2)
  })

  it("requires payout to enforce a destination allowlist", () => {
    expect(getThresholdPolicy("payout").requireDestinationAllowlist).toBe(true)
  })

  it("requires rotation to span at least 2 distinct signer roles", () => {
    expect(getThresholdPolicy("rotation").minDistinctRoles).toBeGreaterThanOrEqual(2)
  })
})

function signers(overrides: Partial<SignerDescriptor>[] = []): SignerDescriptor[] {
  const base: SignerDescriptor[] = [
    { signerId: "issuer-1", role: "issuer", publicKey: KEY_A, weight: 1 },
    { signerId: "issuer-2", role: "issuer", publicKey: KEY_B, weight: 1 },
    { signerId: "issuer-3", role: "issuer", publicKey: KEY_C, weight: 1 },
  ]
  return overrides.length ? (overrides as SignerDescriptor[]) : base
}

describe("validateSignerSetInvariants", () => {
  it("accepts a valid 2-of-3 issuance signer set", () => {
    expect(() => validateSignerSetInvariants({ category: "issuance", signers: signers(), threshold: 2 })).not.toThrow()
  })

  it("rejects a threshold that exceeds total signer weight (permanent lockout)", () => {
    expect(() => validateSignerSetInvariants({ category: "issuance", signers: signers(), threshold: 10 })).toThrow(
      SignerSetInvariantError,
    )
  })

  it("rejects duplicate signerId", () => {
    const dup = [
      { signerId: "issuer-1", role: "issuer", publicKey: KEY_A, weight: 1 },
      { signerId: "issuer-1", role: "issuer", publicKey: KEY_B, weight: 1 },
      { signerId: "issuer-3", role: "issuer", publicKey: KEY_C, weight: 1 },
    ] as SignerDescriptor[]
    expect(() => validateSignerSetInvariants({ category: "issuance", signers: dup, threshold: 2 })).toThrow(/Duplicate signerId/)
  })

  it("rejects duplicate signer public keys", () => {
    const dup = [
      { signerId: "issuer-1", role: "issuer", publicKey: KEY_A, weight: 1 },
      { signerId: "issuer-2", role: "issuer", publicKey: KEY_A, weight: 1 },
      { signerId: "issuer-3", role: "issuer", publicKey: KEY_C, weight: 1 },
    ] as SignerDescriptor[]
    expect(() => validateSignerSetInvariants({ category: "issuance", signers: dup, threshold: 2 })).toThrow(
      /Duplicate signer public key/,
    )
  })

  it("rejects too few signers for the category", () => {
    const tooFew = [{ signerId: "issuer-1", role: "issuer", publicKey: KEY_A, weight: 1 }] as SignerDescriptor[]
    expect(() => validateSignerSetInvariants({ category: "issuance", signers: tooFew, threshold: 1 })).toThrow(
      /requires at least 3 signers/,
    )
  })

  it("rejects a threshold below the category minimum", () => {
    expect(() => validateSignerSetInvariants({ category: "issuance", signers: signers(), threshold: 1 })).toThrow(
      /requires a threshold of at least/,
    )
  })

  it("rejects insufficient distinct roles for rotation", () => {
    const sameRole = [
      { signerId: "issuer-1", role: "issuer", publicKey: KEY_A, weight: 1 },
      { signerId: "issuer-2", role: "issuer", publicKey: KEY_B, weight: 1 },
      { signerId: "issuer-3", role: "issuer", publicKey: KEY_C, weight: 1 },
    ] as SignerDescriptor[]
    expect(() => validateSignerSetInvariants({ category: "rotation", signers: sameRole, threshold: 2 })).toThrow(
      /distinct role/,
    )
  })

  it("rejects a non-positive-integer weight", () => {
    const badWeight = [
      { signerId: "issuer-1", role: "issuer", publicKey: KEY_A, weight: 0 },
      { signerId: "issuer-2", role: "issuer", publicKey: KEY_B, weight: 1 },
      { signerId: "issuer-3", role: "issuer", publicKey: KEY_C, weight: 1 },
    ] as SignerDescriptor[]
    expect(() => validateSignerSetInvariants({ category: "issuance", signers: badWeight, threshold: 1 })).toThrow(
      /positive integer/,
    )
  })
})

describe("assertPayoutWithinPolicy", () => {
  const allowedDestinations = [KEY_B]

  it("accepts a payout within limits to an allowlisted destination", () => {
    expect(() =>
      assertPayoutWithinPolicy({ amount: "1000", destination: KEY_B, allowedDestinations, maxAmount: "5000", dailyLimit: "10000" }),
    ).not.toThrow()
  })

  it("rejects a destination not on the allowlist", () => {
    expect(() =>
      assertPayoutWithinPolicy({ amount: "1000", destination: KEY_C, allowedDestinations, maxAmount: "5000" }),
    ).toThrow(PolicyViolationError)
  })

  it("rejects an amount over the per-operation limit", () => {
    expect(() =>
      assertPayoutWithinPolicy({ amount: "6000", destination: KEY_B, allowedDestinations, maxAmount: "5000" }),
    ).toThrow(/exceeds per-operation limit/)
  })

  it("rejects an amount that would exceed the daily limit", () => {
    expect(() =>
      assertPayoutWithinPolicy({
        amount: "3000",
        destination: KEY_B,
        allowedDestinations,
        dailyTotalSoFar: "8000",
        dailyLimit: "10000",
      }),
    ).toThrow(/exceed daily limit/)
  })

  it("rejects a non-positive amount", () => {
    expect(() => assertPayoutWithinPolicy({ amount: "0", destination: KEY_B, allowedDestinations })).toThrow(/must be positive/)
  })
})
