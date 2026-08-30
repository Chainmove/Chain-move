import { mkdir, writeFile, readdir } from "fs/promises"
import { join } from "path"
import mongoose from "mongoose"
import { encryptBuffer, computeChecksum } from "./crypto"
import { createManifest } from "./manifest"
import type { BackupManifest, BackupOptions, CollectionInfo, IndexInfo } from "./types"
import { DEFAULT_BACKUP_COLLECTIONS } from "./types"

function sanitizeUri(uri: string): string {
  return uri.replace(/\/\/.*@/, "//***@").replace(/[?&]password=[^&]*/gi, "")
}

function generateBackupId(): string {
  const ts = Date.now().toString(36)
  const rand = Math.random().toString(36).slice(2, 8)
  return `backup-${ts}-${rand}`
}

async function getCollectionIndexes(
  collection: mongoose.Collection,
): Promise<IndexInfo[]> {
  const rawIndexes = await collection.indexes()
  return rawIndexes
    .filter((idx: any) => idx.name !== "_id_")
    .map((idx: any) => ({
      name: idx.name as string,
      key: idx.key as Record<string, 1 | -1>,
      unique: idx.unique as boolean | undefined,
      sparse: idx.sparse as boolean | undefined,
      expireAfterSeconds: idx.expireAfterSeconds as number | undefined,
    }))
}

export async function performBackup(options: BackupOptions): Promise<{
  manifest: BackupManifest
  backupPath: string
}> {
  const {
    backupDir,
    encryptionKey,
    keyVersion = "backup-v1",
    retentionDays = 30,
    collections: targetCollections,
    dryRun = false,
  } = options

  const db = mongoose.connection.db
  if (!db) {
    throw new Error("No database connection. Call dbConnect() first.")
  }

  const databaseName = db.databaseName || "unknown"
  const backupId = generateBackupId()
  const backupPath = join(backupDir, backupId)

  if (!dryRun) {
    await mkdir(backupPath, { recursive: true })
  }

  const collectionsToBackup = targetCollections || DEFAULT_BACKUP_COLLECTIONS
  const collectionInfos: CollectionInfo[] = []
  let totalSizeBytes = 0

  const availableCollections = await db.listCollections().toArray()
  const availableNames = new Set(availableCollections.map((c) => c.name))

  for (const collName of collectionsToBackup) {
    if (!availableNames.has(collName)) {
      continue
    }

    const collection = db.collection(collName)
    const documents = await collection.find({}).toArray()
    const indexes = await getCollectionIndexes(collection as any)

    const collectionInfo: CollectionInfo = {
      name: collName,
      documentCount: documents.length,
      indexes,
      checksumSha256: "",
    }

    if (documents.length > 0) {
      const serialized = Buffer.from(JSON.stringify(documents))
      collectionInfo.checksumSha256 = computeChecksum(serialized)
      totalSizeBytes += serialized.length

      if (!dryRun) {
        const encrypted = encryptBuffer(serialized, encryptionKey, keyVersion)
        await writeFile(join(backupPath, `${collName}.enc`), encrypted)
      }
    } else {
      collectionInfo.checksumSha256 = computeChecksum(Buffer.from("[]"))

      if (!dryRun) {
        const emptyEncrypted = encryptBuffer(Buffer.from("[]"), encryptionKey, keyVersion)
        await writeFile(join(backupPath, `${collName}.enc`), emptyEncrypted)
      }
    }

    collectionInfos.push(collectionInfo)
  }

  const manifest = createManifest({
    backupId,
    databaseName,
    collections: collectionInfos,
    encryptionKeyVersion: keyVersion,
    retentionDays,
    environment: process.env.NODE_ENV || "development",
  })

  manifest.totalSizeBytes = totalSizeBytes

  if (!dryRun) {
    await writeFile(
      join(backupPath, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    )
  }

  return { manifest, backupPath }
}

export async function listBackups(backupDir: string): Promise<BackupManifest[]> {
  const entries = await readdir(backupDir, { withFileTypes: true })
  const backups: BackupManifest[] = []

  for (const entry of entries) {
    if (!entry.isDirectory()) continue
    if (!entry.name.startsWith("backup-")) continue

    try {
      const manifestPath = join(backupDir, entry.name, "manifest.json")
      const { readFileSync } = await import("fs")
      const raw = readFileSync(manifestPath, "utf8")
      const manifest = JSON.parse(raw) as BackupManifest
      backups.push(manifest)
    } catch {
      continue
    }
  }

  return backups.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}
