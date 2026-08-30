import { del, put } from "@vercel/blob"

import dbConnect from "../lib/dbConnect"
import { createKycDocumentReference, isPrivateKycBlobUrl } from "../lib/security/kyc-documents"
import KycDocument from "../models/KycDocument"

type MigrationRecord = {
  documentId: string
  sourceUrl: string
  destinationUrl?: string
  status: "inventory" | "migrated" | "failed"
  error?: string
}

const dryRun = process.argv.includes("--dry-run")

function report(record: MigrationRecord) {
  // JSON Lines provides an immutable, machine-readable migration inventory for
  // deployment logs without printing document contents or owner identifiers.
  process.stdout.write(`${JSON.stringify({ ...record, at: new Date().toISOString() })}\n`)
}

async function migrate() {
  await dbConnect()
  const documents = await KycDocument.find({ status: { $ne: "deleted" } })
    .select("_id blobUrl storageKey originalFilename contentType")
    .lean()

  for (const document of documents) {
    const sourceUrl = document.blobUrl
    if (!sourceUrl || isPrivateKycBlobUrl(sourceUrl)) continue

    if (dryRun) {
      report({ documentId: document._id.toString(), sourceUrl, status: "inventory" })
      continue
    }

    try {
      const response = await fetch(sourceUrl, { cache: "no-store" })
      if (!response.ok) throw new Error(`legacy blob returned ${response.status}`)

      const migrated = await put(document.storageKey, await response.arrayBuffer(), {
        access: "private",
        addRandomSuffix: false,
        allowOverwrite: true,
        contentType: "application/json",
      })
      if (!isPrivateKycBlobUrl(migrated.url)) throw new Error("destination store is not private")

      const encryptedRef = createKycDocumentReference({
        url: migrated.url,
        originalFilename: document.originalFilename,
        contentType: document.contentType,
      })
      await KycDocument.updateOne(
        { _id: document._id, blobUrl: sourceUrl },
        { $set: { blobUrl: migrated.url, encryptedRef } },
      )

      const legacyToken = process.env.KYC_LEGACY_PUBLIC_BLOB_TOKEN
      if (legacyToken) await del(sourceUrl, { token: legacyToken })
      report({ documentId: document._id.toString(), sourceUrl, destinationUrl: migrated.url, status: "migrated" })
    } catch (error) {
      report({
        documentId: document._id.toString(),
        sourceUrl,
        status: "failed",
        error: error instanceof Error ? error.message : "unknown migration error",
      })
    }
  }
}

migrate()
  .then(() => process.exit(0))
  .catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : "KYC migration failed"}\n`)
    process.exit(1)
  })
