import { readFileSync, existsSync } from "fs"
import { join } from "path"
import mongoose from "mongoose"
import { decryptBuffer, computeChecksum } from "./crypto"
import { validateManifest } from "./manifest"
import type { BackupManifest, VerifyResult, CollectionVerifyResult } from "./types"

export async function verifyBackupIntegrity(backupPath: string, encryptionKey: string): Promise<VerifyResult> {
  const result: VerifyResult = {
    valid: true,
    errors: [],
    warnings: [],
    collectionResults: {},
  }

  const manifestPath = join(backupPath, "manifest.json")
  if (!existsSync(manifestPath)) {
    result.valid = false
    result.errors.push("manifest.json not found.")
    return result
  }

  let manifest: BackupManifest
  try {
    const raw = readFileSync(manifestPath, "utf8")
    manifest = JSON.parse(raw)
  } catch {
    result.valid = false
    result.errors.push("manifest.json is corrupted or not valid JSON.")
    return result
  }

  if (!validateManifest(manifest)) {
    result.valid = false
    result.errors.push("manifest.json failed schema validation.")
    return result
  }

  if (manifest.collections.length === 0) {
    result.warnings.push("Backup contains no collections.")
  }

  for (const collInfo of manifest.collections) {
    const encPath = join(backupPath, `${collInfo.name}.enc`)
    const collResult: CollectionVerifyResult = {
      documentCount: 0,
      expectedCount: collInfo.documentCount,
      countMatch: false,
      indexCount: 0,
      expectedIndexCount: collInfo.indexes.length,
      indexMatch: false,
      checksumMatch: false,
    }

    if (!existsSync(encPath)) {
      result.valid = false
      result.errors.push(`Collection "${collInfo.name}": encrypted file not found.`)
      result.collectionResults[collInfo.name] = collResult
      continue
    }

    let encryptedData: Buffer
    try {
      encryptedData = readFileSync(encPath)
    } catch {
      result.valid = false
      result.errors.push(`Collection "${collInfo.name}": cannot read encrypted file.`)
      result.collectionResults[collInfo.name] = collResult
      continue
    }

    let decrypted: Buffer
    try {
      const res = decryptBuffer(encryptedData, encryptionKey)
      decrypted = res.buffer
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      result.valid = false
      result.errors.push(`Collection "${collInfo.name}": decryption failed - ${msg}`)
      result.collectionResults[collInfo.name] = collResult
      continue
    }

    let documents: Record<string, unknown>[]
    try {
      documents = JSON.parse(decrypted.toString("utf8"))
    } catch {
      result.valid = false
      result.errors.push(`Collection "${collInfo.name}": decrypted data is not valid JSON.`)
      result.collectionResults[collInfo.name] = collResult
      continue
    }

    if (!Array.isArray(documents)) {
      result.valid = false
      result.errors.push(`Collection "${collInfo.name}": decrypted data is not an array.`)
      result.collectionResults[collInfo.name] = collResult
      continue
    }

    collResult.documentCount = documents.length
    collResult.countMatch = documents.length === collInfo.documentCount

    if (!collResult.countMatch) {
      result.valid = false
      result.errors.push(
        `Collection "${collInfo.name}": expected ${collInfo.documentCount} documents but found ${documents.length}.`,
      )
    }

    const sortedDocs = documents
      .map((d) => JSON.stringify(d, Object.keys(d).sort()))
      .sort()
    const actualChecksum = computeChecksum(Buffer.from(sortedDocs.join("\n")))
    collResult.checksumMatch = actualChecksum === collInfo.checksumSha256

    if (!collResult.checksumMatch) {
      result.valid = false
      result.errors.push(`Collection "${collInfo.name}": checksum mismatch.`)
    }

    collResult.indexMatch = true
    collResult.indexCount = collInfo.indexes.length
  }

  const manifestFiles = manifest.collections.map((c) => `${c.name}.enc`)
  const extraFiles: string[] = []

  try {
    const { readdirSync } = require("fs")
    const files = readdirSync(backupPath)
    for (const file of files) {
      if (file === "manifest.json") continue
      if (!manifestFiles.includes(file)) {
        extraFiles.push(file)
      }
    }
  } catch {
    // Non-critical
  }

  if (extraFiles.length > 0) {
    result.warnings.push(`Extra files in backup: ${extraFiles.join(", ")}`)
  }

  return result
}

export async function verifyRestoredDatabase(
  targetUri: string,
  manifest: BackupManifest,
): Promise<VerifyResult> {
  const result: VerifyResult = {
    valid: true,
    errors: [],
    warnings: [],
    collectionResults: {},
  }

  let connection: mongoose.Connection | null = null

  try {
    connection = await mongoose.createConnection(targetUri, {
      bufferCommands: false,
    }).asPromise()

    const db = connection.db
    if (!db) {
      result.valid = false
      result.errors.push("Failed to connect to restored database.")
      return result
    }

    for (const collInfo of manifest.collections) {
      const collResult: CollectionVerifyResult = {
        documentCount: 0,
        expectedCount: collInfo.documentCount,
        countMatch: false,
        indexCount: 0,
        expectedIndexCount: collInfo.indexes.length,
        indexMatch: false,
        checksumMatch: true,
      }

      const collection = db.collection(collInfo.name)
      const actualCount = await collection.countDocuments()
      collResult.documentCount = actualCount
      collResult.countMatch = actualCount === collInfo.documentCount

      if (!collResult.countMatch) {
        result.valid = false
        result.errors.push(
          `Collection "${collInfo.name}": expected ${collInfo.documentCount} documents, found ${actualCount}.`,
        )
      }

      const indexes = await collection.indexes()
      const userIndexes = indexes.filter((idx: any) => idx.name !== "_id_")
      collResult.indexCount = userIndexes.length
      collResult.indexMatch = userIndexes.length === collInfo.indexes.length

      if (!collResult.indexMatch) {
        result.warnings.push(
          `Collection "${collInfo.name}": expected ${collInfo.indexes.length} indexes, found ${userIndexes.length}.`,
        )
      }

      result.collectionResults[collInfo.name] = collResult
    }
  } finally {
    if (connection) {
      await connection.close()
    }
  }

  return result
}
