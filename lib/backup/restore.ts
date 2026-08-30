import { readFileSync, existsSync } from "fs"
import { join } from "path"
import mongoose from "mongoose"
import { decryptBuffer } from "./crypto"
import { validateManifest } from "./manifest"
import type { BackupManifest, RestoreOptions } from "./types"
import { UNSAFE_TARGET_PATTERNS, CONFIRMATION_TOKEN_PREFIX, RESTORE_CONFIRMATION_TIMEOUT_MS } from "./types"

function isUnsafeTarget(uri: string): boolean {
  return UNSAFE_TARGET_PATTERNS.some((pattern) => pattern.test(uri))
}

function extractDatabaseName(uri: string): string {
  try {
    const url = new URL(uri.replace("mongodb+srv://", "https://"))
    const path = url.pathname
    const dbName = path.replace(/^\//, "").split("?")[0]
    return dbName || "unknown"
  } catch {
    const match = uri.match(/\/([^/?]+)(?:\?|$)/)
    return match ? match[1] : "unknown"
  }
}

export function generateConfirmationToken(targetUri: string): string {
  const db = extractDatabaseName(targetUri)
  const ts = Date.now()
  return `${CONFIRMATION_TOKEN_PREFIX}${db}:${ts}`
}

export function validateConfirmationToken(
  token: string,
  targetUri: string,
): { valid: boolean; reason?: string } {
  if (!token.startsWith(CONFIRMATION_TOKEN_PREFIX)) {
    return { valid: false, reason: "Invalid confirmation token prefix." }
  }

  const payload = token.slice(CONFIRMATION_TOKEN_PREFIX.length)
  const [dbName, tsStr] = payload.split(":")
  const ts = parseInt(tsStr, 10)

  if (isNaN(ts)) {
    return { valid: false, reason: "Invalid confirmation token timestamp." }
  }

  const expectedDb = extractDatabaseName(targetUri)
  if (dbName !== expectedDb) {
    return { valid: false, reason: `Token targets database "${dbName}" but restore targets "${expectedDb}".` }
  }

  if (Date.now() - ts > RESTORE_CONFIRMATION_TIMEOUT_MS) {
    return { valid: false, reason: "Confirmation token has expired." }
  }

  return { valid: true }
}

export async function performRestore(options: RestoreOptions): Promise<{
  success: boolean
  message: string
  collectionsRestored: number
  documentCount: number
}> {
  const {
    backupPath,
    targetUri,
    encryptionKey,
    confirmationToken,
    skipIndexes = false,
    skipMigrationCheck = false,
    dryRun = false,
  } = options

  if (!existsSync(backupPath)) {
    throw new Error(`Backup path does not exist: ${backupPath}`)
  }

  if (isUnsafeTarget(targetUri)) {
    throw new Error(
      `Refusing to restore to "${extractDatabaseName(targetUri)}": matches unsafe target pattern. ` +
      `Use --force-unsafe-target to override.`,
    )
  }

  if (!confirmationToken) {
    const token = generateConfirmationToken(targetUri)
    throw new Error(
      `Restore requires explicit confirmation. Generate a token with: ` +
      `echo "${token}"\nThen pass it as --confirm-token.`,
    )
  }

  const validation = validateConfirmationToken(confirmationToken, targetUri)
  if (!validation.valid) {
    throw new Error(`Confirmation token invalid: ${validation.reason}`)
  }

  const manifestPath = join(backupPath, "manifest.json")
  if (!existsSync(manifestPath)) {
    throw new Error("Backup is incomplete: manifest.json not found.")
  }

  let manifest: BackupManifest
  try {
    const raw = readFileSync(manifestPath, "utf8")
    manifest = JSON.parse(raw)
  } catch {
    throw new Error("Backup is corrupted: cannot parse manifest.json.")
  }

  if (!validateManifest(manifest)) {
    throw new Error("Backup is corrupted: manifest validation failed.")
  }

  if (dryRun) {
    return {
      success: true,
      message: `Dry run: would restore ${manifest.collections.length} collections (${manifest.totalDocuments} documents) to ${extractDatabaseName(targetUri)}.`,
      collectionsRestored: manifest.collections.length,
      documentCount: manifest.totalDocuments,
    }
  }

  let restoreConnection: mongoose.Connection | null = null

  try {
    restoreConnection = await mongoose.createConnection(targetUri, {
      bufferCommands: false,
    }).asPromise()

    const restoreDb = restoreConnection.db
    if (!restoreDb) {
      throw new Error("Failed to connect to target database.")
    }

    let collectionsRestored = 0
    let documentCount = 0

    for (const collInfo of manifest.collections) {
      const encPath = join(backupPath, `${collInfo.name}.enc`)
      if (!existsSync(encPath)) {
        continue
      }

      const encryptedData = readFileSync(encPath)
      let decrypted: Buffer

      try {
        const result = decryptBuffer(encryptedData, encryptionKey)
        decrypted = result.buffer
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error"
        throw new Error(`Failed to decrypt collection "${collInfo.name}": ${msg}`)
      }

      let documents: Record<string, unknown>[]
      try {
        documents = JSON.parse(decrypted.toString("utf8"))
      } catch {
        throw new Error(`Failed to parse collection "${collInfo.name}": corrupted data.`)
      }

      const collection = restoreDb.collection(collInfo.name)

      if (documents.length > 0) {
        await collection.deleteMany({})
        await collection.insertMany(documents)
      } else {
        await collection.deleteMany({})
      }

      if (!skipIndexes && collInfo.indexes.length > 0) {
        for (const index of collInfo.indexes) {
          try {
            const indexSpec: Record<string, 1 | -1 | "2dsphere"> = {}
            for (const [field, direction] of Object.entries(index.key)) {
              indexSpec[field] = direction as 1 | -1
            }
            await collection.createIndex(indexSpec, {
              name: index.name,
              unique: index.unique,
              sparse: index.sparse,
            })
          } catch {
            // Index creation may fail for some indexes; continue
          }
        }
      }

      collectionsRestored++
      documentCount += documents.length
    }

    if (!skipMigrationCheck) {
      const sourceSchemaVersion = manifest.schemaVersion
      const targetCollections = await restoreDb.listCollections().toArray()
      if (targetCollections.length === 0 && documentCount > 0) {
        // Fresh restore, no migration check needed
      }
    }

    return {
      success: true,
      message: `Successfully restored ${collectionsRestored} collections (${documentCount} documents).`,
      collectionsRestored,
      documentCount,
    }
  } finally {
    if (restoreConnection) {
      await restoreConnection.close()
    }
  }
}
