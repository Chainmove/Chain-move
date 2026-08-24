/**
 * Privacy data export pipeline.
 *
 * Walks the data map and produces a structured, encrypted, expiring archive
 * containing only the requesting user's personal data. The archive is
 * encrypted with the AES-256-GCM helper from `lib/backup/crypto.ts` and
 * stored on disk; the database holds metadata + the download token.
 *
 * Cross-user isolation is enforced by filtering every collection with
 * `ownerField = userId` — the request never includes documents owned by any
 * other user.
 */

import { randomBytes } from "crypto"

import dbConnect from "@/lib/dbConnect"
import AuditLog from "@/models/AuditLog"
import DriverPayment from "@/models/DriverPayment"
import DriverVirtualAccount from "@/models/DriverVirtualAccount"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import Investment from "@/models/Investment"
import InvestorCredit from "@/models/InvestorCredit"
import InvestorVirtualAccount from "@/models/InvestorVirtualAccount"
import Issue from "@/models/Issue"
import KycDocument from "@/models/KycDocument"
import Loan from "@/models/Loan"
import Notification from "@/models/Notification"
import NotificationPreference from "@/models/NotificationPreference"
import PoolInvestment from "@/models/PoolInvestment"
import Transaction from "@/models/Transaction"
import User from "@/models/User"
import Vehicle from "@/models/Vehicle"
import WalletRecovery from "@/models/WalletRecovery"

import PrivacyRequest, { type IPrivacyRequest } from "@/models/PrivacyRequest"
import PrivacyExportArchive from "@/models/PrivacyExportArchive"
import {
  PRIVACY_DATA_MAP,
  type PrivacyDataMapEntry,
  RETENTION_POLICY_VERSION,
} from "@/lib/privacy/data-map"
import {
  archiveFileExists,
  deleteArchiveFilesystem,
  getArchiveEncryptionKey,
  getArchiveKeyVersion,
  getArchiveTtlMs,
  persistEncryptedArchive,
} from "@/lib/privacy/archive-storage"
import { computeChecksum } from "@/lib/backup/crypto"
import { logAuditEvent } from "@/lib/security/audit-log"

type ModelLoader = (userId: string) => Promise<any[]>

const MODEL_LOADERS: Record<string, ModelLoader> = {
  User: async (userId) => (await User.findById(userId).lean()) ? [await User.findById(userId).lean()] : [],
  NotificationPreference: async (userId) => NotificationPreference.find({ userId }).lean(),
  KycDocument: async (userId) => KycDocument.find({ userId }).lean(),
  Vehicle: async (userId) => Vehicle.find({ driverId: userId }).lean(),
  Loan: async (userId) => Loan.find({ driverId: userId }).lean(),
  Investment: async (userId) => Investment.find({ investorId: userId }).lean(),
  PoolInvestment: async (userId) => PoolInvestment.find({ userId }).lean(),
  HirePurchaseContract: async (userId) =>
    HirePurchaseContract.find({ driverUserId: userId }).lean(),
  DriverPayment: async (userId) => DriverPayment.find({ driverUserId: userId }).lean(),
  DriverVirtualAccount: async (userId) =>
    DriverVirtualAccount.find({ driverUserId: userId }).lean(),
  InvestorVirtualAccount: async (userId) =>
    InvestorVirtualAccount.find({ investorUserId: userId }).lean(),
  InvestorCredit: async (userId) => InvestorCredit.find({ investorUserId: userId }).lean(),
  Transaction: async (userId) => Transaction.find({ userId }).lean(),
  Notification: async (userId) => Notification.find({ userId }).lean(),
  Issue: async (userId) => Issue.find({ reportedByUserId: userId }).lean(),
  WalletRecovery: async (userId) => WalletRecovery.find({ userId }).lean(),
  AuditLog: async (userId) => AuditLog.find({ actorId: userId }).lean(),
}

function pickExportable(entry: PrivacyDataMapEntry, document: any): any {
  if (!document) return null
  if (entry.exportInclusion === "exclude") return null
  if (entry.exportInclusion === "reference_only") {
    const fields = entry.exportableFields || []
    const out: Record<string, unknown> = {}
    for (const field of fields) {
      if (field in document) out[field] = document[field]
    }
    out._exportKind = "reference_only"
    return out
  }
  const allowed = new Set(entry.exportableFields || entry.personalFields)
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(document)) {
    if (key === "__v" || key === "_id" || key === "password" || key === "rawResponse") continue
    if (allowed.has(key)) {
      out[key] = value
    }
  }
  if (entry.exportInclusion === "include_pseudonymized") {
    out._exportKind = "pseudonymized"
    out._userIdAlias = `ALIAS_${userIdToAlias(String(document.userId || document.driverId || document.investorId || document.actorId || ""))}`
  }
  return out
}

function userIdToAlias(userId: string): string {
  if (!userId) return ""
  // Truncated stable alias — the export never leaks the raw id.
  return userId.slice(-6)
}

/**
 * Builds the unencrypted export bundle as plain JSON. The bundle is a map of
 * section label → records. Internal-only fields are stripped here so they
 * never reach the encryption layer.
 */
export async function buildExportBundle(userId: string): Promise<{
  bundle: Record<string, any[]>
  totalRecords: number
  sectionCount: number
  sections: { label: string; model: string; recordCount: number }[]
}> {
  await dbConnect()
  const bundle: Record<string, any[]> = {}
  let totalRecords = 0
  const sections: { label: string; model: string; recordCount: number }[] = []

  for (const entry of PRIVACY_DATA_MAP) {
    if (entry.exportInclusion === "exclude") continue
    const loader = MODEL_LOADERS[entry.model]
    if (!loader) continue

    const docs = await loader(userId)
    const filtered = docs
      .map((doc) => pickExportable(entry, doc))
      .filter((doc) => doc !== null)

    bundle[entry.label] = filtered
    sections.push({ label: entry.label, model: entry.model, recordCount: filtered.length })
    totalRecords += filtered.length
  }

  return {
    bundle,
    totalRecords,
    sectionCount: sections.length,
    sections,
  }
}

/**
 * Builds and persists a new encrypted archive. Returns the database record.
 */
export async function buildAndPersistArchive(request: IPrivacyRequest): Promise<{
  archiveId: string
  sectionCount: number
  recordCount: number
}> {
  await dbConnect()

  const { bundle, totalRecords, sectionCount, sections } = await buildExportBundle(request.userId)
  const archiveId = `archive_${randomBytes(12).toString("hex")}`
  const downloadToken = randomBytes(32).toString("base64url")
  const encryptionKey = getArchiveEncryptionKey()
  const keyVersion = getArchiveKeyVersion()
  const ttlMs = getArchiveTtlMs()
  const expiresAt = new Date(Date.now() + ttlMs)

  const manifest = {
    archiveId,
    producedAt: new Date().toISOString(),
    userId: request.userId,
    retentionPolicyVersion: RETENTION_POLICY_VERSION,
    sectionCount,
    recordCount: totalRecords,
    sections,
    downloadTokenExpiresAt: expiresAt.toISOString(),
  }

  const payload = Buffer.from(
    JSON.stringify(
      {
        manifest,
        bundle,
        notice: {
          scope: "This bundle contains only data owned by you. It does NOT include other users, secrets, raw provider responses, password hashes, or internal risk notes.",
          providerReferences: extractProviderReferences(sections, request.userId),
        },
      },
      null,
      2,
    ),
    "utf8",
  )

  const { storagePath, byteSize } = await persistEncryptedArchive({
    archiveId,
    payload,
    encryptionKey,
    keyVersion,
  })

  const checksumSha256 = computeChecksum(payload)

  await PrivacyExportArchive.create({
    archiveId,
    userId: request.userId,
    requestId: request.id,
    status: "READY",
    storagePath,
    checksumSha256,
    byteSize,
    encryptionKeyVersion: keyVersion,
    encryptionAlgorithm: "aes-256-gcm",
    sectionCount,
    recordCount: totalRecords,
    downloadToken,
    expiresAt,
    downloadCount: 0,
  })

  await logAuditEvent({
    actor: { _id: request.userId, role: "user" },
    action: "privacy.export.archive_created",
    targetType: "PrivacyExportArchive",
    targetId: archiveId,
    status: "success",
    metadata: {
      requestId: request.id,
      sectionCount,
      recordCount: totalRecords,
      byteSize,
      ttlMs,
    },
  })

  return { archiveId, sectionCount, recordCount: totalRecords }
}

function extractProviderReferences(
  sections: { label: string; model: string; recordCount: number }[],
  userId: string,
) {
  const refs: { model: string; fields: string[] }[] = []
  for (const entry of PRIVACY_DATA_MAP) {
    if (entry.providerReferences && entry.providerReferences.length > 0) {
      refs.push({
        model: entry.model,
        fields: entry.providerReferences.map((r) => r.field),
      })
    }
  }
  return refs
}

/**
 * Sweeps expired archives: marks them EXPIRED, deletes the file from disk,
 * and emits a single audit event.
 */
export async function sweepExpiredArchives(now: Date = new Date()): Promise<number> {
  await dbConnect()

  const expired = await PrivacyExportArchive.find({
    status: "READY",
    expiresAt: { $lte: now },
  })

  for (const archive of expired) {
    const removed = await deleteArchiveFilesystem(archive.archiveId)
    archive.status = "EXPIRED"
    archive.wipedAt = now
    if (removed) archive.storagePath = `${archive.storagePath} (wiped)`
    await archive.save()

    await logAuditEvent({
      actor: null,
      action: "privacy.export.archive_expired",
      targetType: "PrivacyExportArchive",
      targetId: archive.archiveId,
      status: "success",
      metadata: { userId: archive.userId, removedFromDisk: removed },
    })
  }

  return expired.length
}

/**
 * Verifies a download token, marks the archive as downloaded, and returns
 * the decrypted payload. Tokens are opaque, single-purpose values that
 * cannot be used to access other archives.
 */
export async function consumeArchiveDownload({
  archiveId,
  downloadToken,
}: {
  archiveId: string
  downloadToken: string
}): Promise<{ buffer: Buffer; archive: typeof PrivacyExportArchive.prototype } | { error: string; status: number }> {
  await dbConnect()

  const archive = await PrivacyExportArchive.findOne({ archiveId })
  if (!archive) return { error: "Archive not found.", status: 404 }

  if (archive.status !== "READY") {
    return { error: `Archive is not downloadable (status: ${archive.status}).`, status: 410 }
  }

  if (archive.expiresAt.getTime() <= Date.now()) {
    return { error: "Archive has expired.", status: 410 }
  }

  if (archive.downloadToken !== downloadToken) {
    return { error: "Invalid download token.", status: 403 }
  }

  const onDisk = await archiveFileExists(archiveId)
  if (!onDisk) {
    return { error: "Encrypted payload is no longer available.", status: 410 }
  }

  const encryptionKey = getArchiveEncryptionKey()
  const { decryptArchive } = await import("@/lib/privacy/archive-storage")
  const buffer = await decryptArchive({ archiveId, encryptionKey })

  archive.downloadCount = (archive.downloadCount || 0) + 1
  archive.downloadedAt = new Date()
  await archive.save()

  await logAuditEvent({
    actor: { _id: archive.userId, role: "user" },
    action: "privacy.export.archive_downloaded",
    targetType: "PrivacyExportArchive",
    targetId: archiveId,
    status: "success",
    metadata: { downloadCount: archive.downloadCount },
  })

  return { buffer, archive }
}

/**
 * Top-level orchestrator for an EXPORT request. Builds the archive, marks
 * the request as COMPLETED, and persists the archiveId on the request.
 */
export async function executeExportPipeline(
  request: IPrivacyRequest,
  options: { actor?: { id: string; role: "user" | "admin" | "system" } } = {},
): Promise<{ archiveId: string; sectionCount: number; recordCount: number }> {
  if (request.requestType !== "EXPORT") {
    throw new Error("executeExportPipeline called on non-export request")
  }

  request.status = "PROCESSING"
  request.auditHistory.push({
    kind: "processing_started",
    actor: options.actor?.id,
    actorType: options.actor?.role || "system",
    at: new Date(),
  })
  await request.save()

  await logAuditEvent({
    actor: options.actor?.id ? { _id: options.actor.id, role: options.actor.role } : null,
    action: "privacy.export.processing_started",
    targetType: "PrivacyRequest",
    targetId: request.id,
    status: "success",
    metadata: { userId: request.userId },
  })

  try {
    const result = await buildAndPersistArchive(request)
    request.archiveId = result.archiveId
    request.status = "COMPLETED"
    request.auditHistory.push({
      kind: "processing_completed",
      actor: options.actor?.id,
      actorType: options.actor?.role || "system",
      at: new Date(),
      metadata: result,
    })
    await request.save()

    await logAuditEvent({
      actor: options.actor?.id ? { _id: options.actor.id, role: options.actor.role } : null,
      action: "privacy.export.completed",
      targetType: "PrivacyRequest",
      targetId: request.id,
      status: "success",
      metadata: { userId: request.userId, archiveId: result.archiveId },
    })

    return result
  } catch (error) {
    request.status = "FAILED"
    request.lastError = error instanceof Error ? error.message : String(error)
    request.retryCount = (request.retryCount || 0) + 1
    request.auditHistory.push({
      kind: "processing_failed",
      actor: options.actor?.id,
      actorType: options.actor?.role || "system",
      reason: request.lastError,
      at: new Date(),
    })
    await request.save()

    await logAuditEvent({
      actor: options.actor?.id ? { _id: options.actor.id, role: options.actor.role } : null,
      action: "privacy.export.failed",
      targetType: "PrivacyRequest",
      targetId: request.id,
      status: "failure",
      metadata: { userId: request.userId, error: request.lastError },
    })

    throw error
  }
}

/**
 * Returns a sanitized summary of the user's archives, suitable for the
 * GET /api/privacy/requests/:id response.
 */
export async function listUserArchives(userId: string) {
  await dbConnect()
  const archives = await PrivacyExportArchive.find({ userId }).sort({ createdAt: -1 }).lean()
  return archives.map((a) => ({
    archiveId: a.archiveId,
    status: a.status,
    expiresAt: a.expiresAt?.toISOString() || null,
    downloadedAt: a.downloadedAt?.toISOString() || null,
    downloadCount: a.downloadCount,
    sectionCount: a.sectionCount,
    recordCount: a.recordCount,
    byteSize: a.byteSize,
    requestId: a.requestId,
  }))
}

export async function findArchiveByIdForUser(archiveId: string, userId: string) {
  await dbConnect()
  return PrivacyExportArchive.findOne({ archiveId, userId }).lean()
}

export async function findActiveArchiveForRequest(requestId: string) {
  await dbConnect()
  return PrivacyExportArchive.findOne({ requestId, status: "READY" }).lean()
}

/**
 * Helper used by the user-facing routes to re-issue an archive for an
 * expired request without re-running the whole export pipeline.
 */
export async function regenerateArchiveForRequest(
  request: IPrivacyRequest,
  options: { actor?: { id: string; role: "user" | "admin" | "system" } } = {},
): Promise<{ archiveId: string; sectionCount: number; recordCount: number }> {
  // Revoke any previously issued archive for this request.
  const prior = await PrivacyExportArchive.find({ requestId: request.id })
  for (const archive of prior) {
    if (archive.status === "READY") {
      archive.status = "REVOKED"
      archive.revokedAt = new Date()
      archive.revokedBy = options.actor?.id || request.userId
      archive.revokeReason = "Superseded by regenerated archive"
      await archive.save()
      await deleteArchiveFilesystem(archive.archiveId)
    }
  }

  request.archiveRegenerated = true
  await request.save()
  return executeExportPipeline(request, options)
}

/**
 * Verifies that an export bundle for a given user contains no documents
 * owned by any other user. Returns the cross-user leaks found (if any).
 * Used by tests and by the `cross_user_isolation` audit check.
 */
export async function findCrossUserLeaks(
  userId: string,
  bundle: Record<string, any[]>,
): Promise<string[]> {
  await dbConnect()
  const leaks: string[] = []

  for (const entry of PRIVACY_DATA_MAP) {
    if (entry.exportInclusion === "exclude") continue
    const records = bundle[entry.label]
    if (!records) continue

    for (const record of records) {
      const ownerId = String(
        record?.userId ||
          record?.driverId ||
          record?.investorId ||
          record?.investorUserId ||
          record?.driverUserId ||
          record?.actorId ||
          record?.reportedByUserId ||
          "",
      )
      if (ownerId && ownerId !== userId) {
        leaks.push(`Section "${entry.label}" includes document owned by ${ownerId}`)
      }
    }
  }

  return leaks
}

/**
 * Re-export for the same request when the previous archive expired.
 */
export async function refreshExpiredExport(request: IPrivacyRequest) {
  const prior = await PrivacyExportArchive.findOne({ requestId: request.id })
  if (prior && prior.status === "READY" && prior.expiresAt.getTime() > Date.now()) {
    return { archiveId: prior.archiveId, reused: true }
  }
  return regenerateArchiveForRequest(request)
}

/**
 * Returns the most recent ready archive for a request (used by download
 * endpoints).
 */
export async function getLatestArchiveForRequest(requestId: string) {
  await dbConnect()
  return PrivacyExportArchive.findOne({ requestId, status: "READY" })
    .sort({ createdAt: -1 })
    .lean()
}

export async function findRequestByIdForUser(requestId: string, userId: string) {
  await dbConnect()
  const orFilters: any[] = [{ id: requestId }]
  if (/^[0-9a-fA-F]{24}$/.test(requestId)) {
    orFilters.push({ _id: requestId })
  }
  return PrivacyRequest.findOne({ $and: [{ $or: orFilters }, { userId }] }).lean()
}
