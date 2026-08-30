import crypto from "node:crypto"
import mongoose, { type ClientSession } from "mongoose"

import dbConnect from "@/lib/dbConnect"
import ConsentAcceptance, { type ConsentEvidence, type ConsentRenderManifest } from "@/models/ConsentAcceptance"
import ConsentChallenge, { type ConsentIntentType } from "@/models/ConsentChallenge"
import LegalDocumentVersion, { type LegalDocumentKey } from "@/models/LegalDocumentVersion"

export const REQUIRED_INVESTMENT_DOCUMENTS: LegalDocumentKey[] = [
  "risk_disclosure",
  "fee_schedule",
  "privacy_notice",
  "investment_terms",
]

export const REQUIRED_HIRE_PURCHASE_DOCUMENTS: LegalDocumentKey[] = [
  "risk_disclosure",
  "fee_schedule",
  "privacy_notice",
  "hire_purchase_terms",
]

export type ConsentRole = "driver" | "investor" | "admin"

export interface ConsentIntent {
  type: ConsentIntentType
  id: string
  terms: Record<string, unknown>
}

export interface CreateConsentChallengeInput {
  userId: string
  role: ConsentRole
  locale: string
  jurisdiction: string
  requiredDocuments: LegalDocumentKey[]
  intent: ConsentIntent
  expiresInSeconds?: number
  now?: Date
}

export interface AcceptConsentChallengeInput {
  challengeId: string
  userId: string
  role: ConsentRole
  intent: ConsentIntent
  sessionEvidence?: ConsentEvidence
  walletEvidence?: ConsentEvidence
  renderManifest: Omit<
    ConsentRenderManifest,
    "documentSetHash" | "documentVersionIds" | "locale" | "jurisdiction" | "renderedAt"
  > & { renderedAt?: Date }
  now?: Date
  session?: ClientSession
}

export interface ConsentRequirementInput {
  userId: string
  role: ConsentRole
  jurisdiction: string
  intent: ConsentIntent
  requiredDocuments: LegalDocumentKey[]
  acceptanceId?: string
  now?: Date
  session?: ClientSession
}

export class ConsentRequiredError extends Error {
  readonly apiErrorCode = "CONSENT_REQUIRED" as const
  readonly statusCode = 409
  readonly code = "CONSENT_REQUIRED"

  constructor(message = "Consent is required for this action.") {
    super(message)
    this.name = "ConsentRequiredError"
  }
}

export class ConsentRejectedError extends Error {
  readonly apiErrorCode = "CONSENT_INVALID" as const
  readonly statusCode = 409
  readonly code = "CONSENT_INVALID"

  constructor(message = "Consent could not be applied to this action.") {
    super(message)
    this.name = "ConsentRejectedError"
  }
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortForCanonicalJson(value))
}

export function sha256Hex(value: string | Buffer): string {
  return crypto.createHash("sha256").update(value).digest("hex")
}

export function hashEvidenceValue(value: string | undefined | null): string | undefined {
  const trimmed = value?.trim()
  return trimmed ? sha256Hex(trimmed) : undefined
}

function sortForCanonicalJson(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString()
  if (value instanceof mongoose.Types.ObjectId) return value.toString()
  if (
    value &&
    typeof value === "object" &&
    typeof (value as { toObject?: unknown }).toObject === "function"
  ) {
    return sortForCanonicalJson((value as { toObject: () => unknown }).toObject())
  }
  if (Array.isArray(value)) return value.map(sortForCanonicalJson)
  if (!value || typeof value !== "object") return value

  return Object.keys(value as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, key) => {
      acc[key] = sortForCanonicalJson((value as Record<string, unknown>)[key])
      return acc
    }, {})
}

function normalizeLocale(locale: string) {
  return locale.trim().toLowerCase() || "en-ng"
}

function normalizeJurisdiction(jurisdiction: string) {
  return jurisdiction.trim().toUpperCase() || "NG"
}

function assertObjectId(value: string, field: string) {
  if (!mongoose.Types.ObjectId.isValid(value)) {
    throw new ConsentRejectedError(`Invalid ${field}.`)
  }
  return new mongoose.Types.ObjectId(value)
}

function intentSummaryHash(intent: ConsentIntent) {
  return sha256Hex(canonicalJson({ type: intent.type, id: intent.id, terms: intent.terms }))
}

function computeDocumentSetHash(documents: Array<{ _id: unknown; documentKey: string; version: string; sha256: string }>) {
  return sha256Hex(
    canonicalJson(
      documents.map((document) => ({
        id: String(document._id),
        key: document.documentKey,
        version: document.version,
        sha256: document.sha256,
      })),
    ),
  )
}

function challengeHashPayload(input: {
  challengeId: string
  userId: string
  role: ConsentRole
  locale: string
  jurisdiction: string
  documentSetHash: string
  intentType: string
  intentId: string
  intentSummaryHash: string
  nonce: string
  expiresAt: Date
}) {
  return sha256Hex(canonicalJson({ ...input, expiresAt: input.expiresAt.toISOString() }))
}

async function resolveEffectiveDocuments({
  requiredDocuments,
  locale,
  jurisdiction,
  now,
  session,
}: {
  requiredDocuments: LegalDocumentKey[]
  locale: string
  jurisdiction: string
  now: Date
  session?: ClientSession
}) {
  const normalizedLocale = normalizeLocale(locale)
  const fallbackLocale = normalizedLocale.split("-")[0] || "en"
  const localeCandidates = [...new Set([normalizedLocale, fallbackLocale, "en-ng", "en"])]

  const docs = []
  for (const documentKey of requiredDocuments) {
    const candidates = await LegalDocumentVersion.find({
      documentKey,
      jurisdiction: normalizeJurisdiction(jurisdiction),
      locale: { $in: localeCandidates },
      status: "PUBLISHED",
      effectiveFrom: { $lte: now },
      $or: [{ effectiveTo: { $exists: false } }, { effectiveTo: null }, { effectiveTo: { $gt: now } }],
    })
      .sort({ effectiveFrom: -1, createdAt: -1 })
      .session(session || null)

    const match = candidates.sort((a, b) => {
      const localeRankA = localeCandidates.indexOf(a.locale)
      const localeRankB = localeCandidates.indexOf(b.locale)
      return localeRankA - localeRankB || b.effectiveFrom.getTime() - a.effectiveFrom.getTime()
    })[0]

    if (!match) {
      throw new ConsentRequiredError(`No published ${documentKey} document is available for this jurisdiction.`)
    }
    docs.push(match)
  }

  return docs.sort((a, b) => a.documentKey.localeCompare(b.documentKey))
}

export async function createConsentChallenge(input: CreateConsentChallengeInput) {
  await dbConnect()
  const now = input.now || new Date()
  const userObjectId = assertObjectId(input.userId, "user id")
  const locale = normalizeLocale(input.locale)
  const jurisdiction = normalizeJurisdiction(input.jurisdiction)
  const documents = await resolveEffectiveDocuments({
    requiredDocuments: input.requiredDocuments,
    locale,
    jurisdiction,
    now,
  })
  const documentSetHash = computeDocumentSetHash(documents)
  const challengeId = `consent_chal_${crypto.randomUUID()}`
  const nonce = crypto.randomBytes(24).toString("base64url")
  const expiresAt = new Date(now.getTime() + (input.expiresInSeconds || 15 * 60) * 1000)
  const summaryHash = intentSummaryHash(input.intent)
  const challengeHash = challengeHashPayload({
    challengeId,
    userId: input.userId,
    role: input.role,
    locale,
    jurisdiction,
    documentSetHash,
    intentType: input.intent.type,
    intentId: input.intent.id,
    intentSummaryHash: summaryHash,
    nonce,
    expiresAt,
  })

  const challenge = await ConsentChallenge.create({
    challengeId,
    userId: userObjectId,
    role: input.role,
    locale,
    jurisdiction,
    documentVersionIds: documents.map((document) => document._id),
    documentSetHash,
    intent: { type: input.intent.type, id: input.intent.id, summaryHash },
    nonce,
    challengeHash,
    expiresAt,
    status: "OPEN",
  })

  return {
    challengeId: challenge.challengeId,
    challengeHash,
    expiresAt,
    documentSetHash,
    documents: documents.map((document) => ({
      id: document._id.toString(),
      documentKey: document.documentKey,
      version: document.version,
      locale: document.locale,
      jurisdiction: document.jurisdiction,
      title: document.title,
      contentType: document.contentType,
      sha256: document.sha256,
      byteLength: document.byteLength,
    })),
  }
}

export async function acceptConsentChallenge(input: AcceptConsentChallengeInput) {
  await dbConnect()
  const now = input.now || new Date()
  const userObjectId = assertObjectId(input.userId, "user id")
  const summaryHash = intentSummaryHash(input.intent)

  const session = input.session

  try {
    const challenge = await ConsentChallenge.findOneAndUpdate(
      {
        challengeId: input.challengeId,
        userId: userObjectId,
        role: input.role,
        "intent.type": input.intent.type,
        "intent.id": input.intent.id,
        "intent.summaryHash": summaryHash,
        status: "OPEN",
        expiresAt: { $gt: now },
      },
      { $set: { status: "ACCEPTED", acceptedAt: now } },
      { new: true, session },
    )

    if (!challenge) {
      const expired = await ConsentChallenge.findOne({
        challengeId: input.challengeId,
        status: "OPEN",
        expiresAt: { $lte: now },
      }).session(session || null)
      if (expired) {
        expired.status = "EXPIRED"
        await expired.save(session ? { session } : undefined)
      }
      throw new ConsentRejectedError()
    }

    const acceptanceId = `consent_acc_${crypto.randomUUID()}`
    const renderManifest: ConsentRenderManifest = {
      ...input.renderManifest,
      renderedAt: input.renderManifest.renderedAt || now,
      locale: challenge.locale,
      jurisdiction: challenge.jurisdiction,
      documentSetHash: challenge.documentSetHash,
      documentVersionIds: challenge.documentVersionIds.map((id) => id.toString()),
    }
    const consentHash = sha256Hex(
      canonicalJson({
        acceptanceId,
        challengeHash: challenge.challengeHash,
        userId: input.userId,
        role: input.role,
        documentSetHash: challenge.documentSetHash,
        intent: challenge.intent,
        acceptedAt: now.toISOString(),
        renderManifest,
      }),
    )

    const acceptance = await ConsentAcceptance.create(
      [
        {
          acceptanceId,
          challengeId: challenge.challengeId,
          userId: userObjectId,
          role: input.role,
          locale: challenge.locale,
          jurisdiction: challenge.jurisdiction,
          documentVersionIds: challenge.documentVersionIds,
          documentSetHash: challenge.documentSetHash,
          intent: challenge.intent,
          consentHash,
          sessionEvidence: input.sessionEvidence || {},
          walletEvidence: input.walletEvidence,
          renderManifest,
          acceptedAt: now,
          grandfathered: false,
        },
      ],
      { session },
    )

    return acceptance[0]
  } catch (error) {
    throw error
  }
}

export async function requireAcceptedConsent(input: ConsentRequirementInput) {
  await dbConnect()
  if (!input.acceptanceId) throw new ConsentRequiredError()

  const now = input.now || new Date()
  const userObjectId = assertObjectId(input.userId, "user id")
  const summaryHash = intentSummaryHash(input.intent)

  const acceptance = await ConsentAcceptance.findOne({
    acceptanceId: input.acceptanceId,
    userId: userObjectId,
    role: input.role,
    jurisdiction: normalizeJurisdiction(input.jurisdiction),
    "intent.type": input.intent.type,
    "intent.id": input.intent.id,
    "intent.summaryHash": summaryHash,
    withdrawnAt: { $exists: false },
  }).session(input.session || null)

  if (!acceptance) throw new ConsentRejectedError()
  const documents = await resolveEffectiveDocuments({
    requiredDocuments: input.requiredDocuments,
    locale: acceptance.locale,
    jurisdiction: input.jurisdiction,
    now,
    session: input.session,
  })
  const currentDocumentSetHash = computeDocumentSetHash(documents)
  if (acceptance.documentSetHash !== currentDocumentSetHash) throw new ConsentRequiredError("Updated terms require consent.")

  return acceptance
}

export async function verifyLegalDocumentVersionHash(documentVersionId: string) {
  await dbConnect()
  const document = await LegalDocumentVersion.findById(assertObjectId(documentVersionId, "document version id"))
  if (!document) return false
  return document.sha256 === sha256Hex(Buffer.from(document.canonicalBytes, "utf8"))
}

export async function requiresReconsentForMaterialChange(input: {
  userId: string
  intentType: ConsentIntentType
  intentId: string
  jurisdiction: string
  currentDocumentSetHash: string
}) {
  await dbConnect()
  const acceptance = await ConsentAcceptance.findOne({
    userId: assertObjectId(input.userId, "user id"),
    "intent.type": input.intentType,
    "intent.id": input.intentId,
    jurisdiction: normalizeJurisdiction(input.jurisdiction),
    withdrawnAt: { $exists: false },
  })
    .sort({ acceptedAt: -1 })
    .lean()

  if (!acceptance) return true
  if (acceptance.grandfathered) return false
  return acceptance.documentSetHash !== input.currentDocumentSetHash
}

export async function withdrawConsent(input: {
  acceptanceId: string
  userId: string
  reason?: string
  now?: Date
}) {
  await dbConnect()
  const updated = await ConsentAcceptance.findOneAndUpdate(
    {
      acceptanceId: input.acceptanceId,
      userId: assertObjectId(input.userId, "user id"),
      withdrawnAt: { $exists: false },
    },
    { $set: { withdrawnAt: input.now || new Date(), withdrawalReason: input.reason || "User withdrawal" } },
    { new: true },
  )
  if (!updated) throw new ConsentRejectedError("Consent is not withdrawable or was already withdrawn.")
  return updated
}

export async function exportConsentEvidence(input: { acceptanceId: string; userId: string }) {
  await dbConnect()
  const acceptance = await ConsentAcceptance.findOne({
    acceptanceId: input.acceptanceId,
    userId: assertObjectId(input.userId, "user id"),
  }).lean()
  if (!acceptance) throw new ConsentRejectedError("Consent acceptance not found.")

  const documents = await LegalDocumentVersion.find({ _id: { $in: acceptance.documentVersionIds } })
    .select("documentKey version locale jurisdiction title contentType byteLength sha256 effectiveFrom effectiveTo")
    .lean()

  return {
    acceptanceId: acceptance.acceptanceId,
    challengeId: acceptance.challengeId,
    role: acceptance.role,
    locale: acceptance.locale,
    jurisdiction: acceptance.jurisdiction,
    intent: acceptance.intent,
    documentSetHash: acceptance.documentSetHash,
    consentHash: acceptance.consentHash,
    acceptedAt: acceptance.acceptedAt,
    withdrawnAt: acceptance.withdrawnAt || null,
    grandfathered: acceptance.grandfathered,
    renderManifest: acceptance.renderManifest,
    documents,
  }
}
