/**
 * Unit tests for the privacy archive storage helpers.
 *
 * Uses a temporary directory so tests do not collide with each other or
 * leak files outside of the test run.
 */

import { mkdtemp, readFile, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

import { afterEach, beforeEach, describe, expect, it } from "vitest"

let tempDir: string

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "privacy-archive-"))
  process.env.PRIVACY_EXPORT_ARCHIVE_DIR = tempDir
  process.env.PRIVACY_EXPORT_ARCHIVE_KEY = "unit-test-encryption-key-1234567890"
  process.env.PRIVACY_EXPORT_ARCHIVE_KEY_VERSION = "test-v1"
})

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true })
})

describe("privacy/archive-storage", () => {
  it("round-trips an encrypted archive payload", async () => {
    const { persistEncryptedArchive, decryptArchive, getArchiveEncryptionKey, getArchiveKeyVersion } = await import(
      "@/lib/privacy/archive-storage"
    )

    const archiveId = "archive_round_trip"
    const payload = Buffer.from(JSON.stringify({ hello: "world", n: 42 }), "utf8")

    await persistEncryptedArchive({
      archiveId,
      payload,
      encryptionKey: getArchiveEncryptionKey(),
      keyVersion: getArchiveKeyVersion(),
    })

    const decrypted = await decryptArchive({
      archiveId,
      encryptionKey: getArchiveEncryptionKey(),
    })

    expect(decrypted.toString()).toBe(payload.toString())
  })

  it("writes encrypted bytes on disk (plaintext is not stored)", async () => {
    const { persistEncryptedArchive, getArchiveEncryptionKey, getArchiveKeyVersion } = await import(
      "@/lib/privacy/archive-storage"
    )

    const archiveId = "archive_no_plaintext"
    const secret = "super-secret-bundle-contents-12345"
    const payload = Buffer.from(secret, "utf8")

    await persistEncryptedArchive({
      archiveId,
      payload,
      encryptionKey: getArchiveEncryptionKey(),
      keyVersion: getArchiveKeyVersion(),
    })

    const onDisk = await readFile(join(tempDir, `${archiveId}.enc`), "utf8")
    expect(onDisk.includes(secret)).toBe(false)
    expect(onDisk.length).toBeGreaterThan(secret.length)
  })

  it("rejects path traversal attempts", async () => {
    const { persistEncryptedArchive, getArchiveEncryptionKey, getArchiveKeyVersion } = await import(
      "@/lib/privacy/archive-storage"
    )

    await expect(
      persistEncryptedArchive({
        archiveId: "../../etc/passwd",
        payload: Buffer.from("nope"),
        encryptionKey: getArchiveEncryptionKey(),
        keyVersion: getArchiveKeyVersion(),
      }),
    ).rejects.toThrow()
  })

  it("deletes the encrypted file when requested", async () => {
    const { persistEncryptedArchive, deleteArchiveFilesystem, archiveFileExists, getArchiveEncryptionKey, getArchiveKeyVersion } = await import(
      "@/lib/privacy/archive-storage"
    )

    const archiveId = "archive_wipe_me"
    await persistEncryptedArchive({
      archiveId,
      payload: Buffer.from("temporary"),
      encryptionKey: getArchiveEncryptionKey(),
      keyVersion: getArchiveKeyVersion(),
    })
    expect(await archiveFileExists(archiveId)).toBe(true)

    await deleteArchiveFilesystem(archiveId)
    expect(await archiveFileExists(archiveId)).toBe(false)
  })

  it("throws when the encryption key is too short", async () => {
    process.env.PRIVACY_EXPORT_ARCHIVE_KEY = "short"
    const { getArchiveEncryptionKey } = await import("@/lib/privacy/archive-storage")
    expect(() => getArchiveEncryptionKey()).toThrow(/at least 16 characters/)
  })
})
