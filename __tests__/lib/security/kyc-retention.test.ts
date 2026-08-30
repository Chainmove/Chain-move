import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import mongoose from "mongoose"
import KycDocument from "@/models/KycDocument"
import {
  softDeleteDocument,
  setLegalHold,
  computeRetentionExpiry,
  enforceRetentionPolicy,
  markExpiredDocuments,
} from "@/lib/security/kyc-retention"

beforeEach(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chainmove-test")
  }
  await KycDocument.deleteMany({})
})

afterEach(async () => {
  await KycDocument.deleteMany({})
})

async function createTestDoc(overrides: Record<string, unknown> = {}) {
  const userId = new mongoose.Types.ObjectId()
  return KycDocument.create({
    userId,
    documentType: "identity",
    status: "approved",
    storageKey: `kyc/${userId}/${Date.now()}-test.json`,
    blobUrl: "https://blob.vercel-storage.com/test",
    encryptedRef: `kyc-secure:${Buffer.from(JSON.stringify({ version: 1, url: "https://blob.vercel-storage.com/test", originalFilename: "id.pdf", contentType: "application/pdf" })).toString("base64url")}`,
    originalFilename: "id.pdf",
    sanitizedFilename: "id.pdf",
    contentType: "application/pdf",
    fileSize: 1024,
    checksumSha256: "abc123",
    encryptionKeyVersion: "v1",
    scanVerdict: "clean",
    legalHold: false,
    accessCount: 0,
    ...overrides,
  })
}

describe("kyc-retention", () => {
  describe("computeRetentionExpiry", () => {
    it("computes expiry 365 days from now by default", () => {
      const now = new Date("2025-01-01")
      const expiry = computeRetentionExpiry(now)
      expect(expiry.getFullYear()).toBe(2027)
    })

    it("computes expiry with custom retention days", () => {
      const now = new Date("2025-01-01")
      const expiry = computeRetentionExpiry(now, 30)
      expect(expiry.getMonth()).toBe(0)
      expect(expiry.getDate()).toBe(31)
    })
  })

  describe("softDeleteDocument", () => {
    it("soft deletes a document", async () => {
      const doc = await createTestDoc()
      const result = await softDeleteDocument(doc._id.toString())
      expect(result.success).toBe(true)

      const updated = await KycDocument.findById(doc._id)
      expect(updated?.status).toBe("deleted")
      expect(updated?.deletedAt).toBeDefined()
    })

    it("fails for non-existent document", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString()
      const result = await softDeleteDocument(fakeId)
      expect(result.success).toBe(false)
      expect(result.message).toContain("not found")
    })

    it("fails for document under legal hold", async () => {
      const doc = await createTestDoc({ legalHold: true })
      const result = await softDeleteDocument(doc._id.toString())
      expect(result.success).toBe(false)
      expect(result.message).toContain("legal hold")
    })

    it("fails for already deleted document", async () => {
      const doc = await createTestDoc({ status: "deleted", deletedAt: new Date() })
      const result = await softDeleteDocument(doc._id.toString())
      expect(result.success).toBe(false)
      expect(result.message).toContain("already deleted")
    })
  })

  describe("setLegalHold", () => {
    it("applies legal hold", async () => {
      const doc = await createTestDoc()
      const result = await setLegalHold(doc._id.toString(), true)
      expect(result.success).toBe(true)

      const updated = await KycDocument.findById(doc._id)
      expect(updated?.legalHold).toBe(true)
    })

    it("removes legal hold", async () => {
      const doc = await createTestDoc({ legalHold: true })
      const result = await setLegalHold(doc._id.toString(), false)
      expect(result.success).toBe(true)

      const updated = await KycDocument.findById(doc._id)
      expect(updated?.legalHold).toBe(false)
    })

    it("fails for non-existent document", async () => {
      const fakeId = new mongoose.Types.ObjectId().toString()
      const result = await setLegalHold(fakeId, true)
      expect(result.success).toBe(false)
    })
  })

  describe("markExpiredDocuments", () => {
    it("marks expired documents", async () => {
      const pastDate = new Date("2020-01-01")
      await createTestDoc({ retentionExpiresAt: pastDate, status: "approved" })
      await createTestDoc({ retentionExpiresAt: new Date("2099-01-01"), status: "approved" })

      const count = await markExpiredDocuments()
      expect(count).toBe(1)

      const expired = await KycDocument.find({ status: "expired" })
      expect(expired.length).toBe(1)
    })

    it("does not mark documents under legal hold", async () => {
      const pastDate = new Date("2020-01-01")
      await createTestDoc({ retentionExpiresAt: pastDate, status: "approved", legalHold: true })

      const count = await markExpiredDocuments()
      expect(count).toBe(0)
    })

    it("does not mark already deleted documents", async () => {
      const pastDate = new Date("2020-01-01")
      await createTestDoc({ retentionExpiresAt: pastDate, status: "deleted", deletedAt: new Date() })

      const count = await markExpiredDocuments()
      expect(count).toBe(0)
    })
  })

  describe("enforceRetentionPolicy", () => {
    it("processes expired documents", async () => {
      const pastDate = new Date("2020-01-01")
      await createTestDoc({ retentionExpiresAt: pastDate, status: "approved" })

      const result = await enforceRetentionPolicy()
      expect(result.processed).toBeGreaterThanOrEqual(1)
      expect(result.deleted).toBeGreaterThanOrEqual(1)
    })
  })
})
