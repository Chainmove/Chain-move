// @vitest-environment node
import mongoose from "mongoose"
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest"

import {
  acceptConsentChallenge,
  createConsentChallenge,
  exportConsentEvidence,
  REQUIRED_INVESTMENT_DOCUMENTS,
  requireAcceptedConsent,
  requiresReconsentForMaterialChange,
  verifyLegalDocumentVersionHash,
} from "@/lib/consent/financial-consent"
import ConsentAcceptance from "@/models/ConsentAcceptance"
import ConsentChallenge from "@/models/ConsentChallenge"
import InvestmentPool from "@/models/InvestmentPool"
import LegalDocumentVersion, { type LegalDocumentKey } from "@/models/LegalDocumentVersion"
import PoolInvestment from "@/models/PoolInvestment"
import Transaction from "@/models/Transaction"
import User from "@/models/User"

const MONGODB_URI = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove-test"

async function publishDocument(documentKey: LegalDocumentKey, overrides: Record<string, unknown> = {}) {
  const version = String(overrides.version || "2026.07.22")
  return LegalDocumentVersion.create({
    documentKey,
    version,
    locale: "en-ng",
    jurisdiction: "NG",
    title: `${documentKey} ${version}`,
    canonicalBytes: `# ${documentKey}\nVersion ${version}\n`,
    status: "PUBLISHED",
    effectiveFrom: new Date("2026-07-22T00:00:00.000Z"),
    materialChange: false,
    ...overrides,
  })
}

async function publishInvestmentDocumentSet(overrides: Partial<Record<LegalDocumentKey, Record<string, unknown>>> = {}) {
  return Promise.all(REQUIRED_INVESTMENT_DOCUMENTS.map((key) => publishDocument(key, overrides[key] || {})))
}

function investmentIntent(poolId: string, amountNgn = 50_000, txRef = "tx-1", targetAmountNgn = 1_000_000) {
  return {
    type: "pool_investment" as const,
    id: poolId,
    terms: {
      amountNgn,
      txRef,
      poolId,
      targetAmountNgn,
      jurisdiction: "NG",
    },
  }
}

async function createInvestorAndPool() {
  const user = await User.create({
    name: "Investor",
    email: `investor-${new mongoose.Types.ObjectId()}@example.test`,
    role: "investor",
    availableBalance: 200_000,
  })
  const pool = await InvestmentPool.create({
    assetType: "KEKE",
    assetPriceNgn: 1_000_000,
    targetAmountNgn: 1_000_000,
    minContributionNgn: 5_000,
    createdBy: user._id,
    status: "OPEN",
  })
  return { user, pool }
}

async function acceptedInvestmentConsent(userId: string, poolId: string, amountNgn = 50_000, txRef = "tx-1") {
  const challenge = await createConsentChallenge({
    userId,
    role: "investor",
    locale: "en-NG",
    jurisdiction: "NG",
    requiredDocuments: REQUIRED_INVESTMENT_DOCUMENTS,
    intent: investmentIntent(poolId, amountNgn, txRef),
    now: new Date("2026-07-23T10:00:00.000Z"),
  })

  return acceptConsentChallenge({
    challengeId: challenge.challengeId,
    userId,
    role: "investor",
    intent: investmentIntent(poolId, amountNgn, txRef),
    sessionEvidence: { sessionIdHash: "a".repeat(64) },
    walletEvidence: { walletAddressHash: "b".repeat(64) },
    renderManifest: {
      renderer: "web-dashboard@1",
      renderedAt: new Date("2026-07-23T10:01:00.000Z"),
      accessibilityMode: "screen-reader",
      viewport: { width: 390, height: 844 },
    },
    now: new Date("2026-07-23T10:02:00.000Z"),
  })
}

describe("financial consent controls", () => {
  beforeAll(async () => {
    process.env.MONGODB_URI = MONGODB_URI
    await mongoose.connect(MONGODB_URI)
    await mongoose.connection.dropDatabase()
    await Promise.all([LegalDocumentVersion.init(), ConsentChallenge.init(), ConsentAcceptance.init(), PoolInvestment.init()])
  })

  afterEach(async () => {
    await Promise.all([
      LegalDocumentVersion.deleteMany({}),
      ConsentChallenge.deleteMany({}),
      ConsentAcceptance.deleteMany({}),
      PoolInvestment.deleteMany({}),
      InvestmentPool.deleteMany({}),
      Transaction.deleteMany({}),
      User.deleteMany({}),
    ])
  })

  afterAll(async () => {
    await mongoose.connection.close()
  })

  it("publishes immutable, hash-verifiable document versions", async () => {
    const document = await publishDocument("fee_schedule")

    await expect(
      LegalDocumentVersion.updateOne({ _id: document._id }, { $set: { canonicalBytes: "quietly swapped" } }),
    ).rejects.toThrow(/immutable/i)
    await expect(verifyLegalDocumentVersionHash(document._id.toString())).resolves.toBe(true)
  })

  it("lets only one concurrent publication use a document key, locale, jurisdiction, and version", async () => {
    const attempts = await Promise.allSettled([
      publishDocument("risk_disclosure", { version: "2026.08.01" }),
      publishDocument("risk_disclosure", { version: "2026.08.01" }),
    ])

    expect(attempts.filter((result) => result.status === "fulfilled")).toHaveLength(1)
    expect(attempts.filter((result) => result.status === "rejected")).toHaveLength(1)
  })

  it("falls back from regional locale to base locale", async () => {
    await Promise.all(
      REQUIRED_INVESTMENT_DOCUMENTS.map((key) =>
        publishDocument(key, {
          locale: "en",
          version: `base-${key}`,
        }),
      ),
    )

    const user = await User.create({ name: "Investor", role: "investor", availableBalance: 100_000 })
    const challenge = await createConsentChallenge({
      userId: user._id.toString(),
      role: "investor",
      locale: "en-US",
      jurisdiction: "NG",
      requiredDocuments: REQUIRED_INVESTMENT_DOCUMENTS,
      intent: investmentIntent(new mongoose.Types.ObjectId().toString()),
    })

    expect(challenge.documents.every((document) => document.locale === "en")).toBe(true)
  })

  it("rejects expired and replayed consent challenges", async () => {
    await publishInvestmentDocumentSet()
    const { user, pool } = await createInvestorAndPool()
    const intent = investmentIntent(pool._id.toString())
    const challenge = await createConsentChallenge({
      userId: user._id.toString(),
      role: "investor",
      locale: "en-NG",
      jurisdiction: "NG",
      requiredDocuments: REQUIRED_INVESTMENT_DOCUMENTS,
      intent,
      expiresInSeconds: 1,
      now: new Date("2026-07-23T10:00:00.000Z"),
    })

    await expect(
      acceptConsentChallenge({
        challengeId: challenge.challengeId,
        userId: user._id.toString(),
        role: "investor",
        intent,
        renderManifest: { renderer: "web-dashboard@1" },
        now: new Date("2026-07-23T10:00:02.000Z"),
      }),
    ).rejects.toMatchObject({ code: "CONSENT_INVALID" })

    const fresh = await createConsentChallenge({
      userId: user._id.toString(),
      role: "investor",
      locale: "en-NG",
      jurisdiction: "NG",
      requiredDocuments: REQUIRED_INVESTMENT_DOCUMENTS,
      intent,
    })
    await acceptConsentChallenge({
      challengeId: fresh.challengeId,
      userId: user._id.toString(),
      role: "investor",
      intent,
      renderManifest: { renderer: "web-dashboard@1" },
    })
    await expect(
      acceptConsentChallenge({
        challengeId: fresh.challengeId,
        userId: user._id.toString(),
        role: "investor",
        intent,
        renderManifest: { renderer: "web-dashboard@1" },
      }),
    ).rejects.toMatchObject({ code: "CONSENT_INVALID" })
  })

  it("binds every pool investment record to the exact accepted document set", async () => {
    await publishInvestmentDocumentSet()
    const { user, pool } = await createInvestorAndPool()
    const acceptance = await acceptedInvestmentConsent(user._id.toString(), pool._id.toString())

    await requireAcceptedConsent({
      userId: user._id.toString(),
      role: "investor",
      jurisdiction: "NG",
      acceptanceId: acceptance.acceptanceId,
      requiredDocuments: REQUIRED_INVESTMENT_DOCUMENTS,
      intent: investmentIntent(pool._id.toString()),
    })

    await PoolInvestment.create({
      poolId: pool._id,
      userId: user._id,
      amountNgn: 50_000,
      ownershipUnits: 50_000,
      ownershipBps: 500,
      txRef: "tx-1",
      consentAcceptanceId: acceptance.acceptanceId,
      acceptedDocumentSetHash: acceptance.documentSetHash,
      acceptedDocumentVersionIds: acceptance.documentVersionIds,
      status: "CONFIRMED",
    })

    const stored = await PoolInvestment.findOne({ txRef: "tx-1" }).lean<any>()
    expect(stored.consentAcceptanceId).toBe(acceptance.acceptanceId)
    expect(stored.acceptedDocumentSetHash).toBe(acceptance.documentSetHash)
    expect(stored.acceptedDocumentVersionIds).toHaveLength(REQUIRED_INVESTMENT_DOCUMENTS.length)
  })

  it("blocks replay of an acceptance for another amount or transaction", async () => {
    await publishInvestmentDocumentSet()
    const { user, pool } = await createInvestorAndPool()
    const acceptance = await acceptedInvestmentConsent(user._id.toString(), pool._id.toString(), 50_000, "tx-1")

    await expect(
      requireAcceptedConsent({
        userId: user._id.toString(),
        role: "investor",
        jurisdiction: "NG",
        acceptanceId: acceptance.acceptanceId,
        requiredDocuments: REQUIRED_INVESTMENT_DOCUMENTS,
        intent: investmentIntent(pool._id.toString(), 75_000, "tx-2"),
      }),
    ).rejects.toMatchObject({ code: "CONSENT_INVALID" })
  })

  it("requires re-consent when a material fee schedule version changes", async () => {
    await publishInvestmentDocumentSet()
    const { user, pool } = await createInvestorAndPool()
    const acceptance = await acceptedInvestmentConsent(user._id.toString(), pool._id.toString())

    await LegalDocumentVersion.updateOne(
      { documentKey: "fee_schedule", version: "2026.07.22" },
      { $set: { status: "RETIRED", effectiveTo: new Date("2026-08-01T00:00:00.000Z") } },
    )
    await publishDocument("fee_schedule", {
      version: "2026.08.01",
      canonicalBytes: "# fee_schedule\nMaterial fee update\n",
      effectiveFrom: new Date("2026-08-01T00:00:00.000Z"),
      materialChange: true,
    })

    await expect(
      requireAcceptedConsent({
        userId: user._id.toString(),
        role: "investor",
        jurisdiction: "NG",
        acceptanceId: acceptance.acceptanceId,
        requiredDocuments: REQUIRED_INVESTMENT_DOCUMENTS,
        intent: investmentIntent(pool._id.toString()),
        now: new Date("2026-08-02T00:00:00.000Z"),
      }),
    ).rejects.toMatchObject({ code: "CONSENT_REQUIRED" })
  })

  it("honors grandfathered contracts for existing accepted terms", async () => {
    await publishInvestmentDocumentSet()
    const { user, pool } = await createInvestorAndPool()
    const acceptance = await acceptedInvestmentConsent(user._id.toString(), pool._id.toString())
    await ConsentAcceptance.updateOne({ _id: acceptance._id }, { $set: { grandfathered: true } })

    await expect(
      requiresReconsentForMaterialChange({
        userId: user._id.toString(),
        intentType: "pool_investment",
        intentId: pool._id.toString(),
        jurisdiction: "NG",
        currentDocumentSetHash: "c".repeat(64),
      }),
    ).resolves.toBe(false)
  })

  it("exports accessible render evidence without raw identity evidence", async () => {
    await publishInvestmentDocumentSet()
    const { user, pool } = await createInvestorAndPool()
    const acceptance = await acceptedInvestmentConsent(user._id.toString(), pool._id.toString())

    const exported = await exportConsentEvidence({
      acceptanceId: acceptance.acceptanceId,
      userId: user._id.toString(),
    })

    expect(exported.renderManifest.accessibilityMode).toBe("screen-reader")
    expect(exported.documents).toHaveLength(REQUIRED_INVESTMENT_DOCUMENTS.length)
    expect(JSON.stringify(exported)).not.toContain("sessionEvidence")
    expect(JSON.stringify(exported)).not.toContain("walletEvidence")
  })
})
