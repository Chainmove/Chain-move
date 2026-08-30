import { describe, it, expect } from "vitest"
import { createManifest, validateManifest, buildCollectionInfo } from "@/lib/backup/manifest"
import type { BackupManifest } from "@/lib/backup/types"

describe("backup/manifest", () => {
  describe("createManifest", () => {
    it("creates a valid manifest", () => {
      const manifest = createManifest({
        backupId: "backup-test-123",
        databaseName: "chainmove-test",
        collections: [
          { name: "users", documentCount: 10, indexes: [], checksumSha256: "abc" },
          { name: "vehicles", documentCount: 5, indexes: [], checksumSha256: "def" },
        ],
        encryptionKeyVersion: "v1",
        retentionDays: 30,
        environment: "test",
      })

      expect(manifest.version).toBe(2)
      expect(manifest.backupId).toBe("backup-test-123")
      expect(manifest.databaseName).toBe("chainmove-test")
      expect(manifest.totalDocuments).toBe(15)
      expect(manifest.encryptionAlgorithm).toBe("aes-256-gcm")
      expect(manifest.encryptionKeyVersion).toBe("v1")
      expect(manifest.retentionDays).toBe(30)
      expect(manifest.environment).toBe("test")
      expect(manifest.checksumSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(manifest.collections).toHaveLength(2)
    })

    it("includes ISO 8601 createdAt", () => {
      const manifest = createManifest({
        backupId: "test",
        databaseName: "test",
        collections: [],
        encryptionKeyVersion: "v1",
        retentionDays: 7,
        environment: "test",
      })

      expect(new Date(manifest.createdAt).toISOString()).toBe(manifest.createdAt)
    })

    it("sets totalDocuments from collections", () => {
      const manifest = createManifest({
        backupId: "test",
        databaseName: "test",
        collections: [
          { name: "a", documentCount: 100, indexes: [], checksumSha256: "" },
          { name: "b", documentCount: 200, indexes: [], checksumSha256: "" },
          { name: "c", documentCount: 300, indexes: [], checksumSha256: "" },
        ],
        encryptionKeyVersion: "v1",
        retentionDays: 7,
        environment: "test",
      })

      expect(manifest.totalDocuments).toBe(600)
    })
  })

  describe("validateManifest", () => {
    it("accepts valid manifest", () => {
      const manifest = createManifest({
        backupId: "test",
        databaseName: "test",
        collections: [{ name: "users", documentCount: 5, indexes: [], checksumSha256: "abc" }],
        encryptionKeyVersion: "v1",
        retentionDays: 7,
        environment: "test",
      })
      expect(validateManifest(manifest)).toBe(true)
    })

    it("rejects null", () => {
      expect(validateManifest(null)).toBe(false)
    })

    it("rejects non-object", () => {
      expect(validateManifest("string")).toBe(false)
    })

    it("rejects wrong version", () => {
      expect(validateManifest({ version: 1, backupId: "x" })).toBe(false)
    })

    it("rejects missing backupId", () => {
      expect(validateManifest({ version: 2, backupId: "" })).toBe(false)
    })

    it("rejects missing collections", () => {
      expect(validateManifest({ version: 2, backupId: "x", createdAt: "", totalDocuments: 0, checksumSha256: "", encryptionAlgorithm: "aes-256-gcm" })).toBe(false)
    })

    it("rejects non-number totalDocuments", () => {
      expect(validateManifest({ version: 2, backupId: "x", createdAt: "", collections: [], totalDocuments: "10", checksumSha256: "", encryptionAlgorithm: "aes-256-gcm" })).toBe(false)
    })
  })

  describe("buildCollectionInfo", () => {
    it("computes document count", () => {
      const info = buildCollectionInfo({
        name: "users",
        documents: [{ a: 1 }, { b: 2 }, { c: 3 }],
        indexes: [],
      })
      expect(info.documentCount).toBe(3)
    })

    it("computes deterministic checksum regardless of insertion order", () => {
      const docs = [{ a: 1, b: 2 }, { c: 3, d: 4 }]
      const info1 = buildCollectionInfo({ name: "test", documents: docs, indexes: [] })
      const info2 = buildCollectionInfo({ name: "test", documents: [...docs].reverse(), indexes: [] })
      expect(info1.checksumSha256).toBe(info2.checksumSha256)
    })

    it("produces different checksum for different data", () => {
      const info1 = buildCollectionInfo({ name: "a", documents: [{ x: 1 }], indexes: [] })
      const info2 = buildCollectionInfo({ name: "b", documents: [{ y: 2 }], indexes: [] })
      expect(info1.checksumSha256).not.toBe(info2.checksumSha256)
    })

    it("returns 64-char hex checksum", () => {
      const info = buildCollectionInfo({ name: "test", documents: [{ id: 1 }], indexes: [] })
      expect(info.checksumSha256).toMatch(/^[a-f0-9]{64}$/)
    })
  })
})
