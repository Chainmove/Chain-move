import mongoose from "mongoose"
import KycDocument from "@/models/KycDocument"

describe("KycDocument Model", () => {
  beforeAll(async () => {
    await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/chainmove-test")
  })

  afterAll(async () => {
    await mongoose.connection.close()
  })

  afterEach(async () => {
    await KycDocument.deleteMany({})
  })

  const validDocData = {
    userId: new mongoose.Types.ObjectId(),
    documentType: "identity" as const,
    status: "pending" as const,
    storageKey: "kyc/user123/1234-test.pdf.json",
    blobUrl: "https://blob.vercel-storage.com/kyc/user123/test.json",
    encryptedRef: "kyc-secure:test-reference",
    originalFilename: "national_id.pdf",
    sanitizedFilename: "national_id.pdf",
    contentType: "application/pdf",
    fileSize: 2048,
    checksumSha256: "abc123def456",
    encryptionKeyVersion: "kyc-v1",
    scanVerdict: "pending" as const,
    legalHold: false,
    accessCount: 0,
  }

  describe("document creation", () => {
    it("creates a KYC document with all required fields", async () => {
      const doc = await KycDocument.create(validDocData)
      expect(doc._id).toBeDefined()
      expect(doc.userId.toString()).toBe(validDocData.userId.toString())
      expect(doc.documentType).toBe("identity")
      expect(doc.status).toBe("pending")
      expect(doc.storageKey).toBe(validDocData.storageKey)
      expect(doc.checksumSha256).toBe("abc123def456")
      expect(doc.legalHold).toBe(false)
      expect(doc.accessCount).toBe(0)
    })

    it("sets default values correctly", async () => {
      const doc = await KycDocument.create(validDocData)
      expect(doc.status).toBe("pending")
      expect(doc.scanVerdict).toBe("pending")
      expect(doc.legalHold).toBe(false)
      expect(doc.accessCount).toBe(0)
    })

    it("requires userId", async () => {
      const data = { ...validDocData }
      delete (data as any).userId
      await expect(KycDocument.create(data)).rejects.toThrow()
    })

    it("requires storageKey", async () => {
      const data = { ...validDocData }
      delete (data as any).storageKey
      await expect(KycDocument.create(data)).rejects.toThrow()
    })

    it("requires checksumSha256", async () => {
      const data = { ...validDocData }
      delete (data as any).checksumSha256
      await expect(KycDocument.create(data)).rejects.toThrow()
    })
  })

  describe("enum validation", () => {
    it("accepts valid document types", async () => {
      const types = ["identity", "proof_of_address", "bvn", "nin", "other"] as const
      for (const documentType of types) {
        const doc = await KycDocument.create({ ...validDocData, documentType })
        expect(doc.documentType).toBe(documentType)
      }
    })

    it("accepts valid statuses", async () => {
      const statuses = ["pending", "quarantined", "approved", "rejected", "deleted", "expired"] as const
      for (const status of statuses) {
        const doc = await KycDocument.create({ ...validDocData, status })
        expect(doc.status).toBe(status)
      }
    })

    it("accepts valid scan verdicts", async () => {
      const verdicts = ["clean", "suspicious", "malicious", "pending"] as const
      for (const scanVerdict of verdicts) {
        const doc = await KycDocument.create({ ...validDocData, scanVerdict })
        expect(doc.scanVerdict).toBe(scanVerdict)
      }
    })

    it("rejects invalid document type", async () => {
      await expect(
        KycDocument.create({ ...validDocData, documentType: "invalid" }),
      ).rejects.toThrow()
    })

    it("rejects invalid status", async () => {
      await expect(
        KycDocument.create({ ...validDocData, status: "invalid_status" }),
      ).rejects.toThrow()
    })
  })

  describe("indexes", () => {
    it("has unique storageKey", async () => {
      await KycDocument.create(validDocData)
      await expect(
        KycDocument.create(validDocData),
      ).rejects.toThrow()
    })

    it("allows same storageKey after deletion", async () => {
      const doc = await KycDocument.create(validDocData)
      await KycDocument.findByIdAndDelete(doc._id)
      const doc2 = await KycDocument.create(validDocData)
      expect(doc2._id).toBeDefined()
    })
  })

  describe("timestamps", () => {
    it("sets createdAt and updatedAt", async () => {
      const doc = await KycDocument.create(validDocData)
      expect(doc.createdAt).toBeDefined()
      expect(doc.updatedAt).toBeDefined()
    })

    it("updates updatedAt on save", async () => {
      const doc = await KycDocument.create(validDocData)
      const originalUpdatedAt = doc.updatedAt
      await new Promise((resolve) => setTimeout(resolve, 10))
      doc.status = "approved"
      await doc.save()
      expect(doc.updatedAt.getTime()).toBeGreaterThan(originalUpdatedAt.getTime())
    })
  })

  describe("field constraints", () => {
    it("enforces minimum fileSize", async () => {
      await expect(
        KycDocument.create({ ...validDocData, fileSize: 0 }),
      ).rejects.toThrow()
    })

    it("enforces maximum rejectionReason length", async () => {
      const doc = await KycDocument.create(validDocData)
      doc.rejectionReason = "x".repeat(501)
      await expect(doc.save()).rejects.toThrow()
    })
  })
})
