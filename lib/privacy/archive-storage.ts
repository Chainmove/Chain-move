/**
 * Filesystem storage for encrypted privacy-export archives.
 *
 * The archive is an encrypted binary blob produced by `lib/backup/crypto.ts`
 * keyed by `PRIVACY_EXPORT_ARCHIVE_KEY`. The path on disk is derived from the
 * `archiveId`, which makes lookup deterministic without leaking the user
 * identifier.
 */

import { mkdir, readFile, rm, stat, writeFile } from "fs/promises"
import { existsSync } from "fs"
import { join } from "path"

import { decryptBuffer, encryptBuffer } from "@/lib/backup/crypto"

const DEFAULT_BASE_DIR = join(process.cwd(), ".privacy-exports")

function getBaseDir(): string {
  return process.env.PRIVACY_EXPORT_ARCHIVE_DIR || DEFAULT_BASE_DIR
}

function archivePath(archiveId: string): string {
  // Defensive: refuse path traversal from user-supplied ids.
  if (!/^[A-Za-z0-9_-]+$/.test(archiveId)) {
    throw new Error("Invalid archiveId format.")
  }
  return join(getBaseDir(), `${archiveId}.enc`)
}

export type PersistedArchive = {
  archiveId: string
  storagePath: string
  byteSize: number
}

export async function persistEncryptedArchive({
  archiveId,
  payload,
  encryptionKey,
  keyVersion,
}: {
  archiveId: string
  payload: Buffer
  encryptionKey: string
  keyVersion: string
}): Promise<PersistedArchive> {
  const baseDir = getBaseDir()
  if (!existsSync(baseDir)) {
    await mkdir(baseDir, { recursive: true })
  }

  const storagePath = archivePath(archiveId)
  const encrypted = encryptBuffer(payload, encryptionKey, keyVersion)
  await writeFile(storagePath, encrypted)

  return {
    archiveId,
    storagePath,
    byteSize: encrypted.byteLength,
  }
}

export async function readEncryptedArchive(archiveId: string): Promise<Buffer> {
  const storagePath = archivePath(archiveId)
  return readFile(storagePath)
}

export async function decryptArchive({
  archiveId,
  encryptionKey,
}: {
  archiveId: string
  encryptionKey: string
}): Promise<Buffer> {
  const encrypted = await readEncryptedArchive(archiveId)
  const { buffer } = decryptBuffer(encrypted, encryptionKey)
  return buffer
}

export async function archiveFileExists(archiveId: string): Promise<boolean> {
  try {
    const storagePath = archivePath(archiveId)
    await stat(storagePath)
    return true
  } catch {
    return false
  }
}

export async function deleteArchiveFilesystem(archiveId: string): Promise<boolean> {
  try {
    const storagePath = archivePath(archiveId)
    await rm(storagePath, { force: true })
    return true
  } catch {
    return false
  }
}

export function getArchiveKeyVersion(): string {
  return process.env.PRIVACY_EXPORT_ARCHIVE_KEY_VERSION || "privacy-export-v1"
}

export function getArchiveEncryptionKey(): string {
  const key = process.env.PRIVACY_EXPORT_ARCHIVE_KEY
  if (!key || key.length < 16) {
    throw new Error(
      "PRIVACY_EXPORT_ARCHIVE_KEY must be configured with at least 16 characters.",
    )
  }
  return key
}

export function getArchiveTtlMs(): number {
  const hours = Number.parseInt(
    process.env.PRIVACY_EXPORT_ARCHIVE_TTL_HOURS || "168",
    10,
  )
  if (!Number.isFinite(hours) || hours <= 0) return 168 * 60 * 60 * 1000
  return hours * 60 * 60 * 1000
}
