import { describe, it, expect, vi } from "vitest"
import crypto from "crypto"

import { timingSafeEqualHex, timingSafeEqualString } from "@/lib/security/constant-time-compare"

describe("timingSafeEqualHex", () => {
  const expectedHex = crypto.createHmac("sha512", "secret").update("payload").digest("hex")

  it("returns true for the correct hex value", () => {
    expect(timingSafeEqualHex(expectedHex, expectedHex)).toBe(true)
  })

  it("returns false for a missing (null) candidate", () => {
    expect(timingSafeEqualHex(null, expectedHex)).toBe(false)
  })

  it("returns false for a missing (undefined) candidate", () => {
    expect(timingSafeEqualHex(undefined, expectedHex)).toBe(false)
  })

  it("returns false for an empty-string candidate", () => {
    expect(timingSafeEqualHex("", expectedHex)).toBe(false)
  })

  it("returns false for a malformed candidate containing non-hex characters at the correct length", () => {
    const malformed = "z".repeat(expectedHex.length)
    expect(timingSafeEqualHex(malformed, expectedHex)).toBe(false)
  })

  it("returns false for a malformed candidate with a single invalid character", () => {
    const malformed = "g" + expectedHex.slice(1)
    expect(timingSafeEqualHex(malformed, expectedHex)).toBe(false)
  })

  it("returns false for a short candidate", () => {
    expect(timingSafeEqualHex(expectedHex.slice(0, 10), expectedHex)).toBe(false)
  })

  it("returns false for a long candidate", () => {
    expect(timingSafeEqualHex(expectedHex + "ab", expectedHex)).toBe(false)
  })

  it("returns false for a correctly-shaped but wrong-value candidate", () => {
    const wrong = expectedHex.slice(0, -2) + (expectedHex.slice(-2) === "00" ? "11" : "00")
    expect(timingSafeEqualHex(wrong, expectedHex)).toBe(false)
  })

  it("is case-insensitive on the hex charset check (accepts uppercase hex digits)", () => {
    expect(timingSafeEqualHex(expectedHex.toUpperCase(), expectedHex.toUpperCase())).toBe(true)
  })

  it("never throws for any combination of missing/malformed/short/long input", () => {
    const inputs = [null, undefined, "", "not-hex-at-all", "0".repeat(1000), expectedHex.slice(0, 1)]
    for (const input of inputs) {
      expect(() => timingSafeEqualHex(input, expectedHex)).not.toThrow()
    }
  })

  it("never calls crypto.timingSafeEqual for length-mismatched input (would throw if it did)", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual")
    timingSafeEqualHex(expectedHex.slice(0, 10), expectedHex)
    timingSafeEqualHex(expectedHex + "ab", expectedHex)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe("timingSafeEqualString", () => {
  const expected = "Bearer correct-worker-secret-value"

  it("returns true for the correct string", () => {
    expect(timingSafeEqualString(expected, expected)).toBe(true)
  })

  it("returns false for a missing (null) candidate", () => {
    expect(timingSafeEqualString(null, expected)).toBe(false)
  })

  it("returns false for a missing (undefined) candidate", () => {
    expect(timingSafeEqualString(undefined, expected)).toBe(false)
  })

  it("returns false for an empty-string candidate", () => {
    expect(timingSafeEqualString("", expected)).toBe(false)
  })

  it("returns false for a malformed candidate (missing the Bearer prefix)", () => {
    expect(timingSafeEqualString("correct-worker-secret-value", expected)).toBe(false)
  })

  it("returns false for a short (truncated) candidate", () => {
    expect(timingSafeEqualString(expected.slice(0, 10), expected)).toBe(false)
  })

  it("returns false for a long candidate", () => {
    expect(timingSafeEqualString(expected + "-extra", expected)).toBe(false)
  })

  it("returns false for a same-length but wrong-value candidate", () => {
    const sameLengthWrong = expected.replace(/.$/, expected.endsWith("e") ? "x" : "e")
    expect(timingSafeEqualString(sameLengthWrong, expected)).toBe(false)
  })

  it("is byte-exact (case-sensitive)", () => {
    expect(timingSafeEqualString(expected.toUpperCase(), expected)).toBe(false)
  })

  it("never throws for any combination of missing/malformed/short/long input", () => {
    const inputs = [null, undefined, "", "totally different", "x".repeat(1000)]
    for (const input of inputs) {
      expect(() => timingSafeEqualString(input, expected)).not.toThrow()
    }
  })

  it("never calls crypto.timingSafeEqual for length-mismatched input (would throw if it did)", () => {
    const spy = vi.spyOn(crypto, "timingSafeEqual")
    timingSafeEqualString(expected.slice(0, 10), expected)
    timingSafeEqualString(expected + "-extra", expected)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
})
