import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, rm } from "fs/promises"
import { join } from "path"
import mongoose from "mongoose"
import { performBackup } from "@/lib/backup/backup"
import { performRestore } from "@/lib/backup/restore"
import { verifyBackupIntegrity, verifyRestoredDatabase } from "@/lib/backup/verify"
import { generateFixtures, cleanupFixtures } from "@/scripts/backup/generate-fixtures"

const TEST_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/chainmove-drill-test"
const DRILL_DIR = join(process.cwd(), "backups", ".drill-test")
const DRILL_KEY = "drill-test-encryption-key"

beforeEach(async () => {
  await mkdir(DRILL_DIR, { recursive: true })
})

afterEach(async () => {
  try {
    await rm(DRILL_DIR, { recursive: true, force: true })
  } catch {
    // best effort
  }
})

describe("restore drill (integration)", () => {
  it("generates fixtures, backs up, restores, and verifies", async () => {
    const conn = await mongoose.connect(TEST_URI, { bufferCommands: false })
    const db = conn.connection.db || (conn as any).db
    if (!db) throw new Error("No DB")

    try {
      const seed = 42
      const fixtureDataset = await generateFixtures(db, seed)

      expect(fixtureDataset.collectionCount).toBeGreaterThan(0)
      expect(fixtureDataset.documentCount).toBeGreaterThan(0)

      const { manifest, backupPath } = await performBackup({
        backupDir: DRILL_DIR,
        encryptionKey: DRILL_KEY,
        keyVersion: `drill-${seed}`,
        retentionDays: 1,
        collections: Object.keys(fixtureDataset.collections),
      })

      expect(manifest.totalDocuments).toBe(fixtureDataset.documentCount)

      const integrity = await verifyBackupIntegrity(backupPath, DRILL_KEY)
      expect(integrity.valid).toBe(true)
      expect(integrity.errors).toHaveLength(0)

      const restoredUri = TEST_URI.replace(/\/[^/]+$/, "/chainmove-drill-restore-test")
      const token = `restore-confirm:${restoredUri.split("/").pop()}:${Date.now()}`

      const restoreResult = await performRestore({
        backupPath,
        targetUri: restoredUri,
        encryptionKey: DRILL_KEY,
        confirmationToken: token,
      })

      expect(restoreResult.success).toBe(true)
      expect(restoreResult.collectionsRestored).toBeGreaterThanOrEqual(fixtureDataset.collectionCount)
      expect(restoreResult.documentCount).toBe(fixtureDataset.documentCount)

      const dbVerify = await verifyRestoredDatabase(restoredUri, manifest)
      expect(dbVerify.valid).toBe(true)

      await cleanupFixtures(db, Object.keys(fixtureDataset.collections))
    } finally {
      await conn.disconnect()
    }
  })

  it("detects wrong key during restore", async () => {
    const conn = await mongoose.connect(TEST_URI, { bufferCommands: false })
    const db = (conn as any).connection?.db || (conn as any).db
    if (!db) throw new Error("No DB")

    try {
      await db.collection("users").deleteMany({})
      await db.collection("users").insertMany([
        { name: "Drill User", email: "drill@test.com", role: "driver" },
      ])

      const { backupPath } = await performBackup({
        backupDir: DRILL_DIR,
        encryptionKey: DRILL_KEY,
        collections: ["users"],
      })

      await expect(
        performRestore({
          backupPath,
          targetUri: TEST_URI.replace(/\/[^/]+$/, "/chainmove-drill-wrong-key"),
          encryptionKey: "wrong-key-here",
          confirmationToken: "restore-confirm:chainmove-drill-wrong-key:1234",
        }),
      ).rejects.toThrow("Decryption failed")

      await db.collection("users").deleteMany({})
    } finally {
      await conn.disconnect()
    }
  })

  it("detects corrupted archive", async () => {
    const conn = await mongoose.connect(TEST_URI, { bufferCommands: false })
    const db = (conn as any).connection?.db || (conn as any).db
    if (!db) throw new Error("No DB")

    try {
      await db.collection("users").deleteMany({})
      await db.collection("users").insertMany([{ name: "Corrupt Test" }])

      const { backupPath } = await performBackup({
        backupDir: DRILL_DIR,
        encryptionKey: DRILL_KEY,
        collections: ["users"],
      })

      const { writeFileSync } = require("fs")
      writeFileSync(join(backupPath, "users.enc"), "corrupted-garbage-data")

      const integrity = await verifyBackupIntegrity(backupPath, DRILL_KEY)
      expect(integrity.valid).toBe(false)
      expect(integrity.errors.some((e) => e.includes("decryption failed") || e.includes("Decryption failed") || e.includes("corrupted"))).toBe(true)

      await db.collection("users").deleteMany({})
    } finally {
      await conn.disconnect()
    }
  })

  it("fails restore with missing manifest", async () => {
    const emptyDir = join(DRILL_DIR, "empty-backup")
    await mkdir(emptyDir, { recursive: true })

    await expect(
      performRestore({
        backupPath: emptyDir,
        targetUri: "mongodb://localhost:27017/chainmove-drill-test",
        encryptionKey: DRILL_KEY,
        confirmationToken: "restore-confirm:chainmove-drill-test:1234",
      }),
    ).rejects.toThrow("manifest.json not found")
  })

  it("rejects unsafe production target", async () => {
    const conn = await mongoose.connect(TEST_URI, { bufferCommands: false })
    const db = (conn as any).connection?.db || (conn as any).db
    if (!db) throw new Error("No DB")

    try {
      await db.collection("users").deleteMany({})
      await db.collection("users").insertMany([{ name: "Safety Test" }])

      const { backupPath } = await performBackup({
        backupDir: DRILL_DIR,
        encryptionKey: DRILL_KEY,
        collections: ["users"],
      })

      await expect(
        performRestore({
          backupPath,
          targetUri: "mongodb://localhost:27017/chainmove",
          encryptionKey: DRILL_KEY,
          confirmationToken: "restore-confirm:chainmove:1234",
        }),
      ).rejects.toThrow("unsafe target")

      await expect(
        performRestore({
          backupPath,
          targetUri: "mongodb://localhost:27017/production",
          encryptionKey: DRILL_KEY,
          confirmationToken: "restore-confirm:production:1234",
        }),
      ).rejects.toThrow("unsafe target")

      await db.collection("users").deleteMany({})
    } finally {
      await conn.disconnect()
    }
  })

  it("verifies restored database document counts", async () => {
    const conn = await mongoose.connect(TEST_URI, { bufferCommands: false })
    const db = (conn as any).connection?.db || (conn as any).db
    if (!db) throw new Error("No DB")

    try {
      const seed = 99
      const fixtureDataset = await generateFixtures(db, seed)

      const { manifest, backupPath } = await performBackup({
        backupDir: DRILL_DIR,
        encryptionKey: DRILL_KEY,
        keyVersion: `drill-${seed}`,
        collections: Object.keys(fixtureDataset.collections),
      })

      const restoredUri = TEST_URI.replace(/\/[^/]+$/, "/chainmove-drill-counts")
      const token = `restore-confirm:${restoredUri.split("/").pop()}:${Date.now()}`

      await performRestore({
        backupPath,
        targetUri: restoredUri,
        encryptionKey: DRILL_KEY,
        confirmationToken: token,
      })

      const verify = await verifyRestoredDatabase(restoredUri, manifest)

      for (const [name, info] of Object.entries(verify.collectionResults)) {
        expect(info.countMatch).toBe(true)
      }

      await cleanupFixtures(db, Object.keys(fixtureDataset.collections))
    } finally {
      await conn.disconnect()
    }
  })
})
