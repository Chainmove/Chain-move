import { describe, it, expect, beforeEach, afterEach, vi } from "vitest"
import {
  registerScanHook,
  clearScanHook,
  runScanHook,
  isDocumentAccessible,
  isDocumentBlocked,
} from "@/lib/security/kyc-scanning"
import mongoose from "mongoose"
import KycDocument from "@/models/KycDocument"

beforeEach(async () => {
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chainmove-test")
  }
  clearScanHook()
  await KycDocument.deleteMany({})
})

afterEach(async () => {
  clearScanHook()
  await KycDocument.deleteMany({})
})

describe("kyc-scanning", () => {
  describe("scan hook registration", () => {
    it("returns clean verdict when no hook is registered", async () => {
      const result = await runScanHook("doc1", Buffer.from("test"), {
        filename: "test.pdf",
        contentType: "application/pdf",
        checksumSha256: "abc123",
      })
      expect(result.verdict).toBe("clean")
    })

    it("calls registered hook with correct arguments", async () => {
      const hookFn = vi.fn().mockResolvedValue({ verdict: "clean" as const })
      registerScanHook(hookFn)

      const buffer = Buffer.from("test data")
      const metadata = { filename: "doc.pdf", contentType: "application/pdf", checksumSha256: "hash123" }
      await runScanHook("doc1", buffer, metadata)

      expect(hookFn).toHaveBeenCalledWith(buffer, metadata)
    })

    it("clears registered hook", async () => {
      const hookFn = vi.fn().mockResolvedValue({ verdict: "clean" as const })
      registerScanHook(hookFn)
      clearScanHook()

      await runScanHook("doc1", Buffer.from("test"), {
        filename: "test.pdf",
        contentType: "application/pdf",
        checksumSha256: "abc",
      })
      expect(hookFn).not.toHaveBeenCalled()
    })
  })

  describe("quarantine behavior", () => {
    it("quarantines document when hook returns suspicious", async () => {
      const userId = new mongoose.Types.ObjectId()
      const doc = await KycDocument.create({
        userId,
        documentType: "identity",
        status: "pending",
        storageKey: "kyc/test/file.json",
        blobUrl: "https://blob.vercel-storage.com/test",
        encryptedRef: "kyc-secure:test",
        originalFilename: "id.pdf",
        sanitizedFilename: "id.pdf",
        contentType: "application/pdf",
        fileSize: 1024,
        checksumSha256: "abc123",
        encryptionKeyVersion: "v1",
        scanVerdict: "pending",
        legalHold: false,
        accessCount: 0,
      })

      registerScanHook(async () => ({
        verdict: "suspicious",
        details: { reason: "Suspicious pattern detected" },
      }))

      const result = await runScanHook(doc._id.toString(), Buffer.from("test"), {
        filename: "id.pdf",
        contentType: "application/pdf",
        checksumSha256: "abc123",
      })

      expect(result.verdict).toBe("suspicious")

      const updated = await KycDocument.findById(doc._id)
      expect(updated?.status).toBe("quarantined")
      expect(updated?.scanVerdict).toBe("suspicious")
      expect(updated?.quarantinedAt).toBeDefined()
    })

    it("quarantines document when hook throws error", async () => {
      const userId = new mongoose.Types.ObjectId()
      const doc = await KycDocument.create({
        userId,
        documentType: "identity",
        status: "pending",
        storageKey: "kyc/test/file.json",
        blobUrl: "https://blob.vercel-storage.com/test",
        encryptedRef: "kyc-secure:test",
        originalFilename: "id.pdf",
        sanitizedFilename: "id.pdf",
        contentType: "application/pdf",
        fileSize: 1024,
        checksumSha256: "abc123",
        encryptionKeyVersion: "v1",
        scanVerdict: "pending",
        legalHold: false,
        accessCount: 0,
      })

      registerScanHook(async () => {
        throw new Error("Scanner crash")
      })

      const result = await runScanHook(doc._id.toString(), Buffer.from("test"), {
        filename: "id.pdf",
        contentType: "application/pdf",
        checksumSha256: "abc123",
      })

      expect(result.verdict).toBe("suspicious")

      const updated = await KycDocument.findById(doc._id)
      expect(updated?.status).toBe("quarantined")
    })

    it("does not quarantine clean documents", async () => {
      const userId = new mongoose.Types.ObjectId()
      const doc = await KycDocument.create({
        userId,
        documentType: "identity",
        status: "pending",
        storageKey: "kyc/test/file.json",
        blobUrl: "https://blob.vercel-storage.com/test",
        encryptedRef: "kyc-secure:test",
        originalFilename: "id.pdf",
        sanitizedFilename: "id.pdf",
        contentType: "application/pdf",
        fileSize: 1024,
        checksumSha256: "abc123",
        encryptionKeyVersion: "v1",
        scanVerdict: "pending",
        legalHold: false,
        accessCount: 0,
      })

      registerScanHook(async () => ({ verdict: "clean" }))

      await runScanHook(doc._id.toString(), Buffer.from("test"), {
        filename: "id.pdf",
        contentType: "application/pdf",
        checksumSha256: "abc123",
      })

      const updated = await KycDocument.findById(doc._id)
      expect(updated?.status).toBe("pending")
      expect(updated?.scanVerdict).toBe("clean")
    })
  })

  describe("access helpers", () => {
    it("isDocumentAccessible for approved and pending", () => {
      expect(isDocumentAccessible("approved")).toBe(true)
      expect(isDocumentAccessible("pending")).toBe(true)
      expect(isDocumentAccessible("quarantined")).toBe(false)
      expect(isDocumentAccessible("deleted")).toBe(false)
      expect(isDocumentAccessible("expired")).toBe(false)
    })

    it("isDocumentBlocked for quarantined, deleted, expired", () => {
      expect(isDocumentBlocked("quarantined")).toBe(true)
      expect(isDocumentBlocked("deleted")).toBe(true)
      expect(isDocumentBlocked("expired")).toBe(true)
      expect(isDocumentBlocked("approved")).toBe(false)
      expect(isDocumentBlocked("pending")).toBe(false)
    })
  })
})
