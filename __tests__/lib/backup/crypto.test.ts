import { describe, it, expect } from "vitest"
import { encryptBuffer, decryptBuffer, computeChecksum } from "@/lib/backup/crypto"

describe("backup/crypto", () => {
  const testKey = "test-backup-encryption-key-1234"
  const testKeyVersion = "test-v1"

  describe("encryptBuffer / decryptBuffer", () => {
    it("roundtrips a simple buffer", () => {
      const original = Buffer.from("Hello, backup world!")
      const encrypted = encryptBuffer(original, testKey, testKeyVersion)
      const { buffer, keyVersion } = decryptBuffer(encrypted, testKey)

      expect(buffer.toString()).toBe("Hello, backup world!")
      expect(keyVersion).toBe(testKeyVersion)
    })

    it("roundtrips large JSON data", () => {
      const data = Array.from({ length: 1000 }, (_, i) => ({
        id: i,
        name: `user-${i}`,
        amount: Math.random() * 1000000,
        nested: { field: "value", timestamp: Date.now() },
      }))
      const original = Buffer.from(JSON.stringify(data))
      const encrypted = encryptBuffer(original, testKey, "v2")
      const { buffer, keyVersion } = decryptBuffer(encrypted, testKey)

      const parsed = JSON.parse(buffer.toString())
      expect(parsed).toHaveLength(1000)
      expect(parsed[0].name).toBe("user-0")
      expect(keyVersion).toBe("v2")
    })

    it("roundtrips empty buffer", () => {
      const original = Buffer.alloc(0)
      const encrypted = encryptBuffer(original, testKey, testKeyVersion)
      const { buffer } = decryptBuffer(encrypted, testKey)
      expect(buffer.length).toBe(0)
    })

    it("produces different ciphertext each time (random IV)", () => {
      const original = Buffer.from("same data")
      const enc1 = encryptBuffer(original, testKey, testKeyVersion)
      const enc2 = encryptBuffer(original, testKey, testKeyVersion)

      expect(enc1.equals(enc2)).toBe(false)
    })

    it("fails decryption with wrong key", () => {
      const original = Buffer.from("secret data")
      const encrypted = encryptBuffer(original, testKey, testKeyVersion)

      expect(() => decryptBuffer(encrypted, "wrong-key")).toThrow("Decryption failed")
    })

    it("fails with tampered ciphertext", () => {
      const original = Buffer.from("secret data")
      const encrypted = encryptBuffer(original, testKey, testKeyVersion)

      const payload = JSON.parse(encrypted.toString())
      payload.data = Buffer.from("tampered").toString("base64")
      const tampered = Buffer.from(JSON.stringify(payload))

      expect(() => decryptBuffer(tampered, testKey)).toThrow()
    })

    it("fails with tampered auth tag", () => {
      const original = Buffer.from("secret data")
      const encrypted = encryptBuffer(original, testKey, testKeyVersion)

      const payload = JSON.parse(encrypted.toString())
      payload.tag = Buffer.from("tampered-tag-data").toString("base64")
      const tampered = Buffer.from(JSON.stringify(payload))

      expect(() => decryptBuffer(tampered, testKey)).toThrow()
    })

    it("fails with invalid JSON input", () => {
      expect(() => decryptBuffer(Buffer.from("not-json"), testKey)).toThrow("not valid JSON")
    })

    it("fails with malformed payload structure", () => {
      const bad = JSON.stringify({ version: 1, iv: "x", data: "y" })
      expect(() => decryptBuffer(Buffer.from(bad), testKey)).toThrow("Malformed")
    })

    it("preserves binary data integrity", () => {
      const original = Buffer.alloc(256)
      for (let i = 0; i < 256; i++) {
        original[i] = i
      }
      const encrypted = encryptBuffer(original, testKey, testKeyVersion)
      const { buffer } = decryptBuffer(encrypted, testKey)

      expect(buffer.length).toBe(256)
      for (let i = 0; i < 256; i++) {
        expect(buffer[i]).toBe(i)
      }
    })
  })

  describe("computeChecksum", () => {
    it("returns consistent SHA-256 hash", () => {
      const data = Buffer.from("test data")
      const c1 = computeChecksum(data)
      const c2 = computeChecksum(data)
      expect(c1).toBe(c2)
    })

    it("returns 64-char hex string", () => {
      const checksum = computeChecksum(Buffer.from("test"))
      expect(checksum).toMatch(/^[a-f0-9]{64}$/)
    })

    it("returns different hash for different data", () => {
      const c1 = computeChecksum(Buffer.from("data1"))
      const c2 = computeChecksum(Buffer.from("data2"))
      expect(c1).not.toBe(c2)
    })

    it("returns different hash for empty vs non-empty", () => {
      const c1 = computeChecksum(Buffer.alloc(0))
      const c2 = computeChecksum(Buffer.from("x"))
      expect(c1).not.toBe(c2)
    })
  })
})
