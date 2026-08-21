import { createHmac } from "crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  createSignedDocumentUrl,
  verifySignedDocumentUrl,
} from "@/lib/security/kyc-signed-urls"

describe("kyc-signed-urls", () => {
  const documentId = "doc_123"
  const userId = "user_456"
  const originalEnv = { ...process.env }

  beforeEach(() => {
    process.env.MONGODB_URI = "mongodb://localhost:27017/chainmove-test"
    process.env.KYC_DOCUMENT_SIGNING_KEY = "test-only-document-signing-secret"
    process.env.KYC_DOCUMENT_SIGNING_KEY_ID = "document-url-v1"
    delete process.env.KYC_DOCUMENT_SIGNING_KEYS_JSON
  })

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  describe("createSignedDocumentUrl", () => {
    it("returns a URL with token parameter", () => {
      const { url } = createSignedDocumentUrl(documentId, userId)
      expect(url).toContain(`/api/kyc-documents/${documentId}?token=`)
    })

    it("returns a valid expiry timestamp", () => {
      const { expiresAt } = createSignedDocumentUrl(documentId, userId)
      expect(expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000))
      expect(expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 360)
    })

    it("respects custom TTL", () => {
      const { expiresAt } = createSignedDocumentUrl(documentId, userId, 120)
      const now = Math.floor(Date.now() / 1000)
      expect(expiresAt).toBeGreaterThanOrEqual(now + 119)
      expect(expiresAt).toBeLessThanOrEqual(now + 121)
    })
  })

  describe("verifySignedDocumentUrl", () => {
    it("validates a correctly signed token", () => {
      const { url } = createSignedDocumentUrl(documentId, userId)
      const token = new URL(url, "http://localhost").searchParams.get("token")!
      const result = verifySignedDocumentUrl(token)
      expect(result.valid).toBe(true)
      expect(result.payload?.documentId).toBe(documentId)
      expect(result.payload?.userId).toBe(userId)
    })

    it("rejects tampered payload", () => {
      const { url } = createSignedDocumentUrl(documentId, userId)
      const token = new URL(url, "http://localhost").searchParams.get("token")!
      const parts = token.split("|")
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString())
      payload.userId = "tampered_user"
      const tamperedPayload = Buffer.from(JSON.stringify(payload)).toString("base64url")
      const tamperedToken = `${parts[0]}|${tamperedPayload}|${parts[2]}`
      const result = verifySignedDocumentUrl(tamperedToken)
      expect(result.valid).toBe(false)
      expect(result.error).toContain("Invalid signature")
    })

    it("rejects expired token", () => {
      const { url } = createSignedDocumentUrl(documentId, userId, 1)
      const token = new URL(url, "http://localhost").searchParams.get("token")!
      const parts = token.split("|")
      const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString())
      payload.expiresAt = Math.floor(Date.now() / 1000) - 10
      const expiredPayload = Buffer.from(JSON.stringify(payload)).toString("base64url")
      const signature = createHmac("sha256", process.env.KYC_DOCUMENT_SIGNING_KEY!)
        .update(expiredPayload)
        .digest("base64url")
      const expiredToken = `${parts[0]}|${expiredPayload}|${signature}`
      const result = verifySignedDocumentUrl(expiredToken)
      expect(result.valid).toBe(false)
      expect(result.error).toContain("expired")
    })

    it("rejects malformed token", () => {
      expect(verifySignedDocumentUrl("garbage").valid).toBe(false)
      expect(verifySignedDocumentUrl("a|b|c|d").valid).toBe(false)
      expect(verifySignedDocumentUrl("").valid).toBe(false)
    })

    it("rejects token with invalid base64", () => {
      expect(verifySignedDocumentUrl("key|!!!invalid!!!|signature").valid).toBe(false)
    })

    it("rejects the former public fallback signing key", () => {
      const payload = Buffer.from(JSON.stringify({
        documentId,
        userId,
        expiresAt: Math.floor(Date.now() / 1000) + 60,
        nonce: "known",
        keyId: "document-url-v1",
      })).toString("base64url")
      const signature = createHmac("sha256", "fallback-signing-key").update(payload).digest("base64url")

      expect(verifySignedDocumentUrl(`document-url-v1|${payload}|${signature}`).valid).toBe(false)
    })

    it("verifies only explicitly retained previous keys during rotation", () => {
      process.env.KYC_DOCUMENT_SIGNING_KEYS_JSON = JSON.stringify({
        active: { id: "document-url-v1", secret: "first-document-signing-secret-123" },
        previous: [],
      })
      delete process.env.KYC_DOCUMENT_SIGNING_KEY
      const { url } = createSignedDocumentUrl(documentId, userId)
      const token = new URL(url, "http://localhost").searchParams.get("token")!

      process.env.KYC_DOCUMENT_SIGNING_KEYS_JSON = JSON.stringify({
        active: { id: "document-url-v2", secret: "second-document-signing-secret-456" },
        previous: [{ id: "document-url-v1", secret: "first-document-signing-secret-123" }],
      })
      expect(verifySignedDocumentUrl(token).valid).toBe(true)

      process.env.KYC_DOCUMENT_SIGNING_KEYS_JSON = JSON.stringify({
        active: { id: "document-url-v2", secret: "second-document-signing-secret-456" },
        previous: [],
      })
      expect(verifySignedDocumentUrl(token)).toMatchObject({ valid: false, error: "Unknown or retired signing key." })
    })

    it("fails closed when the dedicated key is missing", () => {
      delete process.env.KYC_DOCUMENT_SIGNING_KEY
      expect(() => createSignedDocumentUrl(documentId, userId)).toThrow("KYC_DOCUMENT_SIGNING_KEY")
      expect(() => verifySignedDocumentUrl("document-url-v1|payload|signature")).toThrow("KYC_DOCUMENT_SIGNING_KEY")
    })
  })
})
