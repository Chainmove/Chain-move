import { del } from "@vercel/blob"
import KycDocument from "@/models/KycDocument"
import type { IKycDocument } from "@/models/KycDocument"
import { logAuditEvent } from "@/lib/security/audit-log"
import dbConnect from "@/lib/dbConnect"

const DEFAULT_RETENTION_DAYS = 365 * 2

export type RetentionResult = {
  processed: number
  deleted: number
  skipped: number
  errors: string[]
}

export async function enforceRetentionPolicy(): Promise<RetentionResult> {
  await dbConnect()
  const now = new Date()
  const result: RetentionResult = { processed: 0, deleted: 0, skipped: 0, errors: [] }

  const expiredDocs = await KycDocument.find({
    status: { $in: ["approved", "rejected", "expired"] },
    legalHold: false,
    retentionExpiresAt: { $lte: now },
    deletedAt: null,
  }).limit(100)

  for (const doc of expiredDocs) {
    result.processed++
    try {
      await softDeleteDocument(doc._id.toString(), undefined, "retention_policy")
      result.deleted++
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Unknown error"
      result.errors.push(`Failed to delete document ${doc._id}: ${msg}`)
    }
  }

  return result
}

export async function softDeleteDocument(
  documentId: string,
  deletedByUserId?: string,
  reason: string = "manual_deletion",
): Promise<{ success: boolean; message: string }> {
  await dbConnect()

  const doc = await KycDocument.findById(documentId)
  if (!doc) {
    return { success: false, message: "Document not found." }
  }

  if (doc.legalHold) {
    return { success: false, message: "Cannot delete document under legal hold." }
  }

  if (doc.status === "deleted") {
    return { success: false, message: "Document is already deleted." }
  }

  await KycDocument.findByIdAndUpdate(documentId, {
    status: "deleted",
    deletedAt: new Date(),
    deletedBy: deletedByUserId || undefined,
  })

  try {
    await del(doc.blobUrl)
  } catch {
    // Blob may already be gone; log but don't fail
  }

  await logAuditEvent({
    action: "kyc.document.delete",
    targetType: "kyc_document",
    targetId: documentId,
    metadata: { reason, storageKey: doc.storageKey, userId: doc.userId?.toString() },
  })

  return { success: true, message: "Document deleted." }
}

export async function setLegalHold(
  documentId: string,
  hold: boolean,
): Promise<{ success: boolean; message: string }> {
  await dbConnect()

  const doc = await KycDocument.findById(documentId)
  if (!doc) {
    return { success: false, message: "Document not found." }
  }

  await KycDocument.findByIdAndUpdate(documentId, { legalHold: hold })

  await logAuditEvent({
    action: hold ? "kyc.document.legal_hold.set" : "kyc.document.legal_hold.remove",
    targetType: "kyc_document",
    targetId: documentId,
    metadata: { legalHold: hold, userId: doc.userId?.toString() },
  })

  return { success: true, message: hold ? "Legal hold applied." : "Legal hold removed." }
}

export function computeRetentionExpiry(uploadDate: Date, retentionDays: number = DEFAULT_RETENTION_DAYS): Date {
  const expiry = new Date(uploadDate)
  expiry.setDate(expiry.getDate() + retentionDays)
  return expiry
}

export async function markExpiredDocuments(): Promise<number> {
  await dbConnect()
  const now = new Date()

  const result = await KycDocument.updateMany(
    {
      status: { $in: ["approved", "rejected"] },
      legalHold: false,
      retentionExpiresAt: { $lte: now },
      deletedAt: null,
    },
    { $set: { status: "expired" } },
  )

  return result.modifiedCount
}

export async function replaceDocument(
  oldDocumentId: string,
  newDocumentId: string,
): Promise<{ success: boolean; message: string }> {
  await dbConnect()

  const oldDoc = await KycDocument.findById(oldDocumentId)
  if (!oldDoc) {
    return { success: false, message: "Original document not found." }
  }

  const newDoc = await KycDocument.findById(newDocumentId)
  if (!newDoc) {
    return { success: false, message: "New document not found." }
  }

  if (oldDoc.userId.toString() !== newDoc.userId.toString()) {
    return { success: false, message: "Cannot replace document across users." }
  }

  await KycDocument.findByIdAndUpdate(oldDocumentId, {
    replacementDocumentId: newDocumentId,
    status: "deleted",
    deletedAt: new Date(),
  })

  try {
    await del(oldDoc.blobUrl)
  } catch {
    // Blob may already be gone
  }

  await logAuditEvent({
    action: "kyc.document.replace",
    targetType: "kyc_document",
    targetId: oldDocumentId,
    metadata: {
      replacedWith: newDocumentId,
      userId: oldDoc.userId?.toString(),
      oldStorageKey: oldDoc.storageKey,
    },
  })

  return { success: true, message: "Document replaced." }
}
