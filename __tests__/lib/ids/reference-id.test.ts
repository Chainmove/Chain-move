import { describe, it, expect, vi } from "vitest"

import { REFERENCE_ID_VERSION, generateReferenceId } from "@/lib/ids/reference-id"

describe("generateReferenceId", () => {
  describe("format", () => {
    it("produces the documented prefix/version/timestamp/entropy shape for an underscore separator", () => {
      const id = generateReferenceId({ prefix: "cm_wallet" })
      expect(id).toMatch(/^cm_wallet_v1_[0-9a-z]+_[0-9a-f]{32}$/)
      expect(id.split("_")).toEqual(expect.arrayContaining([REFERENCE_ID_VERSION]))
    })

    it("produces the documented shape for a hyphen separator, matching the settlement id convention", () => {
      const id = generateReferenceId({ prefix: "STL", separator: "-" })
      expect(id).toMatch(/^STL-v1-[0-9a-z]+-[0-9a-f]{32}$/)
    })

    it("matches the exact prefix used by each of the four finance-critical producers", () => {
      expect(generateReferenceId({ prefix: "cm_wallet" })).toMatch(/^cm_wallet_v1_/)
      expect(generateReferenceId({ prefix: "STL", separator: "-" })).toMatch(/^STL-v1-/)
      expect(generateReferenceId({ prefix: "cm_driver_repay" })).toMatch(/^cm_driver_repay_v1_/)
      expect(generateReferenceId({ prefix: "fxq" })).toMatch(/^fxq_v1_/)
    })

    it("embeds the current format version so historical ids can be told apart from future format changes", () => {
      const id = generateReferenceId({ prefix: "cm_wallet" })
      expect(id).toContain(`_${REFERENCE_ID_VERSION}_`)
    })

    it("only uses characters within Paystack's documented reference charset (alphanumeric plus -, ., =) for provider-bound prefixes", () => {
      // cm_wallet / cm_driver_repay references are sent to Paystack as the
      // `reference` field. The prefix itself intentionally keeps the existing
      // underscore convention (already live in production); the generated
      // version/timestamp/entropy segments this function controls must stay
      // within Paystack's documented charset on their own.
      const id = generateReferenceId({ prefix: "cm_wallet" })
      const [, version, timestamp, entropy] = id.split("_")
      expect(`${version}${timestamp}${entropy}`).toMatch(/^[A-Za-z0-9]+$/)
    })

    it("respects a custom entropyBytes size", () => {
      const id = generateReferenceId({ prefix: "x", entropyBytes: 4 })
      const entropySegment = id.split("_").pop()
      expect(entropySegment).toMatch(/^[0-9a-f]{8}$/)
    })

    it("defaults to 16 bytes (128 bits) of entropy, hex-encoded to 32 characters", () => {
      const id = generateReferenceId({ prefix: "x" })
      const entropySegment = id.split("_").pop()
      expect(entropySegment).toHaveLength(32)
    })
  })

  describe("cryptographic entropy source", () => {
    it("never calls Math.random, the non-cryptographic source the issue flags as collision-prone", () => {
      const mathRandomSpy = vi.spyOn(Math, "random")

      for (let i = 0; i < 50; i++) generateReferenceId({ prefix: "cm_wallet" })

      expect(mathRandomSpy).not.toHaveBeenCalled()
      mathRandomSpy.mockRestore()
    })
  })

  describe("high-volume uniqueness", () => {
    it("produces no duplicates across 100,000 ids generated back-to-back, including within the same millisecond", () => {
      const seen = new Set<string>()
      const count = 100_000

      for (let i = 0; i < count; i++) {
        seen.add(generateReferenceId({ prefix: "cm_wallet" }))
      }

      expect(seen.size).toBe(count)
    })

    it("produces no duplicates across the four live prefixes generated interleaved", () => {
      const seen = new Set<string>()
      const prefixes = [
        { prefix: "cm_wallet" },
        { prefix: "STL", separator: "-" },
        { prefix: "cm_driver_repay" },
        { prefix: "fxq" },
      ]
      const perPrefix = 10_000

      for (let i = 0; i < perPrefix; i++) {
        for (const options of prefixes) {
          seen.add(generateReferenceId(options))
        }
      }

      expect(seen.size).toBe(perPrefix * prefixes.length)
    })
  })
})
