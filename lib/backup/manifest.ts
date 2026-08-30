import { computeChecksum } from "./crypto"
import type { BackupManifest, CollectionInfo, IndexInfo } from "./types"

const CURRENT_VERSION = 2 as const

export function createManifest({
  backupId,
  databaseName,
  collections,
  encryptionKeyVersion,
  retentionDays,
  environment,
}: {
  backupId: string
  databaseName: string
  collections: CollectionInfo[]
  encryptionKeyVersion: string
  retentionDays: number
  environment: string
}): BackupManifest {
  const totalDocuments = collections.reduce((sum, c) => sum + c.documentCount, 0)

  const manifestData = JSON.stringify({
    version: CURRENT_VERSION,
    backupId,
    createdAt: new Date().toISOString(),
    collections: collections.map((c) => ({
      name: c.name,
      documentCount: c.documentCount,
      checksumSha256: c.checksumSha256,
    })),
    totalDocuments,
  })

  return {
    version: CURRENT_VERSION,
    backupId,
    createdAt: new Date().toISOString(),
    appVersion: getAppVersion(),
    schemaVersion: getSchemaVersion(),
    databaseName,
    collections,
    totalDocuments,
    totalSizeBytes: 0,
    checksumSha256: computeChecksum(Buffer.from(manifestData)),
    encryptionAlgorithm: "aes-256-gcm",
    encryptionKeyVersion,
    retentionDays,
    environment,
  }
}

export function validateManifest(manifest: unknown): manifest is BackupManifest {
  if (!manifest || typeof manifest !== "object") return false
  const m = manifest as Record<string, unknown>
  if (m.version !== CURRENT_VERSION) return false
  if (typeof m.backupId !== "string" || m.backupId.length === 0) return false
  if (typeof m.createdAt !== "string") return false
  if (!Array.isArray(m.collections)) return false
  if (typeof m.totalDocuments !== "number") return false
  if (typeof m.checksumSha256 !== "string") return false
  if (typeof m.encryptionAlgorithm !== "string") return false
  return true
}

export function buildCollectionInfo({
  name,
  documents,
  indexes,
}: {
  name: string
  documents: Record<string, unknown>[]
  indexes: IndexInfo[]
}): CollectionInfo {
  const sortedDocs = documents.map((d) => JSON.stringify(d, Object.keys(d).sort())).sort()
  const checksum = computeChecksum(Buffer.from(sortedDocs.join("\n")))

  return {
    name,
    documentCount: documents.length,
    indexes,
    checksumSha256: checksum,
  }
}

function getAppVersion(): string {
  try {
    const pkg = require("../../package.json")
    return pkg.version || "unknown"
  } catch {
    return "unknown"
  }
}

function getSchemaVersion(): string {
  const timestamp = new Date().toISOString().slice(0, 10)
  return `schema-${timestamp}`
}
