import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import KycDocument from "@/models/KycDocument"
import { parseKycDocumentReference, isAllowedKycBlobUrl } from "@/lib/security/kyc-documents"
import { logAuditEvent } from "@/lib/security/audit-log"

export type MigrationResult = {
  usersProcessed: number
  documentsCreated: number
  documentsSkipped: number
  errors: string[]
}

export async function migrateKycDocumentReferences(): Promise<MigrationResult> {
  await dbConnect()

  const result: MigrationResult = {
    usersProcessed: 0,
    documentsCreated: 0,
    documentsSkipped: 0,
    errors: [],
  }

  const users = await User.find({
    kycDocuments: { $exists: true, $ne: [], $not: { $size: 0 } },
  }).lean()

  for (const user of users) {
    result.usersProcessed++
    const documents = Array.isArray(user.kycDocuments) ? user.kycDocuments : []

    for (const ref of documents) {
      try {
        if (typeof ref !== "string" || ref.trim().length === 0) {
          result.documentsSkipped++
          continue
        }

        const existingDoc = await KycDocument.findOne({ encryptedRef: ref }).lean()
        if (existingDoc) {
          result.documentsSkipped++
          continue
        }

        const secureRef = parseKycDocumentReference(ref)
        let blobUrl = ref
        let originalFilename = "unknown"
        let contentType = "application/octet-stream"

        if (secureRef) {
          blobUrl = secureRef.url
          originalFilename = secureRef.originalFilename
          contentType = secureRef.contentType
        } else if (!isAllowedKycBlobUrl(ref)) {
          result.documentsSkipped++
          continue
        }

        const inferredType = inferDocumentType(originalFilename)

        await KycDocument.create({
          userId: user._id,
          documentType: inferredType,
          status: "approved",
          storageKey: `migrated/${user._id}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          blobUrl,
          encryptedRef: ref,
          originalFilename,
          sanitizedFilename: originalFilename.replace(/[^a-zA-Z0-9._-]/g, "_"),
          contentType,
          fileSize: 0,
          checksumSha256: "migrated",
          encryptionKeyVersion: "migrated",
          scanVerdict: "pending",
          legalHold: false,
          accessCount: 0,
        })

        result.documentsCreated++
      } catch (error) {
        const msg = error instanceof Error ? error.message : "Unknown error"
        result.errors.push(`Failed to migrate reference for user ${user._id}: ${msg}`)
      }
    }
  }

  await logAuditEvent({
    action: "kyc.migration.completed",
    targetType: "system",
    metadata: {
      usersProcessed: result.usersProcessed,
      documentsCreated: result.documentsCreated,
      documentsSkipped: result.documentsSkipped,
      errorCount: result.errors.length,
    },
  })

  return result
}

function inferDocumentType(filename: string): "identity" | "proof_of_address" | "bvn" | "nin" | "other" {
  const lower = filename.toLowerCase()
  if (lower.includes("nin") || lower.includes("national_id")) return "nin"
  if (lower.includes("bvn")) return "bvn"
  if (lower.includes("address") || lower.includes("proof")) return "proof_of_address"
  if (lower.includes("id") || lower.includes("passport") || lower.includes("license")) return "identity"
  return "other"
}
