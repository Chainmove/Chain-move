import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { mkdir, rm, readdir, readFile, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"
import mongoose from "mongoose"
import { performBackup, listBackups } from "@/lib/backup/backup"
import { performRestore, generateConfirmationToken, validateConfirmationToken } from "@/lib/backup/restore"
import { verifyBackupIntegrity, verifyRestoredDatabase } from "@/lib/backup/verify"
import { encryptBuffer, decryptBuffer } from "@/lib/backup/crypto"
import { createManifest, validateManifest } from "@/lib/backup/manifest"
import { CONFIRMATION_TOKEN_PREFIX } from "@/lib/backup/types"

const TEST_DB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/chainmove-backup-test"
const TEST_BACKUP_DIR = join(process.cwd(), "backups", ".test-backup")
const TEST_ENCRYPTION_KEY = "test-backup-key-for-integration-tests"

beforeEach(async () => {
  await mkdir(TEST_BACKUP_DIR, { recursive: true })
})

afterEach(async () => {
  try {
    await rm(TEST_BACKUP_DIR, { recursive: true, force: true })
  } catch {
    // cleanup best effort
  }
})

async function seedTestData(db: mongoose.Connection["db"]) {
  if (!db) throw new Error("No DB connection")

  await db.collection("users").deleteMany({})
  await db.collection("vehicles").deleteMany({})

  await db.collection("users").insertMany([
    { name: "Test User 1", email: "test1@backup.test", role: "driver", kycStatus: "approved_stage1" },
    { name: "Test User 2", email: "test2@backup.test", role: "investor", kycStatus: "pending" },
  ])

  await db.collection("vehicles").insertMany([
    { name: "Vehicle 1", type: "shuttle", year: 2024, price: 5000000, status: "Available" },
  ])
}

describe("backup/backup", () => {
  let connection: any

  beforeEach(async () => {
    connection = await mongoose.connect(TEST_DB_URI, { bufferCommands: false })
    const db = connection.connection?.db || connection.db
    await seedTestData(db)
  })

  afterEach(async () => {
    const db = connection.connection?.db || connection.db
    if (db) {
      await db.collection("users").deleteMany({})
      await db.collection("vehicles").deleteMany({})
    }
    await connection.disconnect()
  })

  it("creates a backup with encrypted files", async () => {
    const { manifest, backupPath } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users", "vehicles"],
    })

    expect(manifest.backupId).toMatch(/^backup-/)
    expect(manifest.collections.length).toBeGreaterThanOrEqual(2)
    expect(manifest.totalDocuments).toBeGreaterThanOrEqual(3)
    expect(existsSync(join(backupPath, "manifest.json"))).toBe(true)
    expect(existsSync(join(backupPath, "users.enc"))).toBe(true)

    const encContent = await readFile(join(backupPath, "users.enc"))
    const { buffer } = decryptBuffer(encContent, TEST_ENCRYPTION_KEY)
    const docs = JSON.parse(buffer.toString())
    expect(Array.isArray(docs)).toBe(true)
    expect(docs.length).toBe(2)
  })

  it("dry run does not write files", async () => {
    const { manifest, backupPath } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users"],
      dryRun: true,
    })

    expect(manifest.backupId).toMatch(/^backup-/)
    expect(existsSync(backupPath)).toBe(false)
  })

  it("handles empty collections", async () => {
    if (connection.db) {
      await connection.db.collection("notifications").deleteMany({})
    }

    const { manifest } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["notifications"],
    })

    const notifColl = manifest.collections.find((c) => c.name === "notifications")
    expect(notifColl).toBeDefined()
    expect(notifColl!.documentCount).toBe(0)
  })

  it("encrypts with key version", async () => {
    const { manifest, backupPath } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      keyVersion: "rotate-v2",
      collections: ["users"],
    })

    expect(manifest.encryptionKeyVersion).toBe("rotate-v2")

    const encContent = await readFile(join(backupPath, "users.enc"))
    const payload = JSON.parse(encContent.toString())
    expect(payload.keyVersion).toBe("rotate-v2")
  })

  it("lists backups sorted by date", async () => {
    await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users"],
    })

    await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users"],
    })

    const backups = await listBackups(TEST_BACKUP_DIR)
    expect(backups.length).toBe(2)
    expect(new Date(backups[0].createdAt).getTime()).toBeGreaterThanOrEqual(
      new Date(backups[1].createdAt).getTime(),
    )
  })
})

describe("backup/restore", () => {
  it("generates and validates confirmation tokens", () => {
    const token = generateConfirmationToken("mongodb://localhost:27017/testdb")
    expect(token).toContain(CONFIRMATION_TOKEN_PREFIX)

    const result = validateConfirmationToken(token, "mongodb://localhost:27017/testdb")
    expect(result.valid).toBe(true)
  })

  it("rejects token for wrong database", () => {
    const token = generateConfirmationToken("mongodb://localhost:27017/db1")
    const result = validateConfirmationToken(token, "mongodb://localhost:27017/db2")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("targets database")
  })

  it("rejects expired token", () => {
    const oldToken = `${CONFIRMATION_TOKEN_PREFIX}testdb:${Date.now() - 600000}`
    const result = validateConfirmationToken(oldToken, "mongodb://localhost:27017/testdb")
    expect(result.valid).toBe(false)
    expect(result.reason).toContain("expired")
  })

  it("refuses unsafe target patterns", async () => {
    const unsafeUris = [
      "mongodb://localhost:27017/chainmove",
      "mongodb://localhost:27017/production",
      "mongodb://localhost:27017/prod",
      "mongodb+srv://user:pass@cluster.mongodb.net/chainmove",
    ]

    for (const uri of unsafeUris) {
      await expect(
        performRestore({
          backupPath: TEST_BACKUP_DIR,
          targetUri: uri,
          encryptionKey: TEST_ENCRYPTION_KEY,
          confirmationToken: "restore-confirm:",
        }),
      ).rejects.toThrow("unsafe target")
    }
  })

  it("fails without confirmation token in non-dry-run", async () => {
    await expect(
      performRestore({
        backupPath: TEST_BACKUP_DIR,
        targetUri: "mongodb://localhost:27017/safetest",
        encryptionKey: TEST_ENCRYPTION_KEY,
      }),
    ).rejects.toThrow("explicit confirmation")
  })

  it("fails when backup path does not exist", async () => {
    await expect(
      performRestore({
        backupPath: "/nonexistent/path",
        targetUri: "mongodb://localhost:27017/safetest",
        encryptionKey: TEST_ENCRYPTION_KEY,
        confirmationToken: "restore-confirm:safetest:1234",
      }),
    ).rejects.toThrow("does not exist")
  })

  it("fails when manifest.json is missing", async () => {
    const emptyDir = join(TEST_BACKUP_DIR, "empty-backup")
    await mkdir(emptyDir, { recursive: true })

    await expect(
      performRestore({
        backupPath: emptyDir,
        targetUri: "mongodb://localhost:27017/safetest",
        encryptionKey: TEST_ENCRYPTION_KEY,
        confirmationToken: "restore-confirm:safetest:1234",
      }),
    ).rejects.toThrow("manifest.json not found")
  })

  it("fails with wrong encryption key", async () => {
    const conn: any = await mongoose.connect(TEST_DB_URI, { bufferCommands: false })
    await seedTestData(conn.connection?.db || conn.db)

    const { backupPath } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users"],
    })

    const token = generateConfirmationToken("mongodb://localhost:27017/safetest")

    await expect(
      performRestore({
        backupPath,
        targetUri: "mongodb://localhost:27017/safetest",
        encryptionKey: "completely-wrong-key",
        confirmationToken: token,
      }),
    ).rejects.toThrow("Decryption failed")

    await conn.disconnect()
  })

  it("dry run reports what would be restored", async () => {
    const conn: any = await mongoose.connect(TEST_DB_URI, { bufferCommands: false })
    await seedTestData(conn.connection?.db || conn.db)

    const { backupPath } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users", "vehicles"],
    })

    const result = await performRestore({
      backupPath,
      targetUri: "mongodb://localhost:27017/safetest",
      encryptionKey: TEST_ENCRYPTION_KEY,
      dryRun: true,
    })

    expect(result.success).toBe(true)
    expect(result.collectionsRestored).toBeGreaterThanOrEqual(2)
    expect(result.documentCount).toBeGreaterThanOrEqual(3)

    await conn.disconnect()
  })
})

describe("backup/verify", () => {
  let connection: any

  beforeEach(async () => {
    connection = await mongoose.connect(TEST_DB_URI, { bufferCommands: false })
    const db = connection.connection?.db || connection.db
    await seedTestData(db)
  })

  afterEach(async () => {
    const db = connection.connection?.db || connection.db
    if (db) {
      await db.collection("users").deleteMany({})
      await db.collection("vehicles").deleteMany({})
    }
    await connection.disconnect()
  })

  it("passes verification for valid backup", async () => {
    const { backupPath } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users", "vehicles"],
    })

    const result = await verifyBackupIntegrity(backupPath, TEST_ENCRYPTION_KEY)
    expect(result.valid).toBe(true)
    expect(result.errors).toHaveLength(0)
  })

  it("fails when encrypted file is missing", async () => {
    const { backupPath } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users"],
    })

    const encPath = join(backupPath, "users.enc")
    const { unlinkSync } = require("fs")
    unlinkSync(encPath)

    const result = await verifyBackupIntegrity(backupPath, TEST_ENCRYPTION_KEY)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("encrypted file not found"))).toBe(true)
  })

  it("fails with wrong encryption key", async () => {
    const { backupPath } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users"],
    })

    const result = await verifyBackupIntegrity(backupPath, "wrong-key")
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("Decryption failed"))).toBe(true)
  })

  it("fails with corrupted encrypted file", async () => {
    const { backupPath } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users"],
    })

    const encPath = join(backupPath, "users.enc")
    await writeFile(encPath, "corrupted-data-not-valid")

    const result = await verifyBackupIntegrity(backupPath, TEST_ENCRYPTION_KEY)
    expect(result.valid).toBe(false)
  })

  it("fails when manifest.json is missing", async () => {
    const emptyDir = join(TEST_BACKUP_DIR, "no-manifest")
    await mkdir(emptyDir, { recursive: true })

    const result = await verifyBackupIntegrity(emptyDir, TEST_ENCRYPTION_KEY)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain("manifest.json not found")
  })

  it("fails with corrupted manifest", async () => {
    const corruptDir = join(TEST_BACKUP_DIR, "corrupt-manifest")
    await mkdir(corruptDir, { recursive: true })
    await writeFile(join(corruptDir, "manifest.json"), "not-valid-json{{{")

    const result = await verifyBackupIntegrity(corruptDir, TEST_ENCRYPTION_KEY)
    expect(result.valid).toBe(false)
    expect(result.errors[0]).toContain("corrupted")
  })

  it("detects document count mismatch after tampering", async () => {
    const { backupPath, manifest } = await performBackup({
      backupDir: TEST_BACKUP_DIR,
      encryptionKey: TEST_ENCRYPTION_KEY,
      collections: ["users"],
    })

    const usersColl = manifest.collections.find((c) => c.name === "users")
    if (usersColl) {
      usersColl.documentCount = 999
      const { writeFileSync } = require("fs")
      writeFileSync(join(backupPath, "manifest.json"), JSON.stringify(manifest, null, 2))
    }

    const result = await verifyBackupIntegrity(backupPath, TEST_ENCRYPTION_KEY)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("expected 999"))).toBe(true)
  })
})
