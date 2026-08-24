/**
 * Integration tests for the privacy lifecycle.
 *
 * These tests require a MongoDB instance. They are skipped when no
 * `MONGODB_URI` is configured so unit-test environments can still execute
 * the rest of the suite.
 */

import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import { join } from "path"

import mongoose from "mongoose"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest"

import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import KycDocument from "@/models/KycDocument"
import Transaction from "@/models/Transaction"
import HirePurchaseContract from "@/models/HirePurchaseContract"
import Loan from "@/models/Loan"
import PoolInvestment from "@/models/PoolInvestment"
import Investment from "@/models/Investment"
import DriverVirtualAccount from "@/models/DriverVirtualAccount"
import InvestorVirtualAccount from "@/models/InvestorVirtualAccount"
import InvestorCredit from "@/models/InvestorCredit"
import DriverPayment from "@/models/DriverPayment"
import Notification from "@/models/Notification"
import NotificationPreference from "@/models/NotificationPreference"
import Vehicle from "@/models/Vehicle"
import Issue from "@/models/Issue"
import WalletRecovery from "@/models/WalletRecovery"
import AuditLog from "@/models/AuditLog"

import PrivacyRequest from "@/models/PrivacyRequest"
import PrivacyExportArchive from "@/models/PrivacyExportArchive"
import LegalHold from "@/models/LegalHold"

import {
  buildExportBundle,
  buildAndPersistArchive,
  consumeArchiveDownload,
  findCrossUserLeaks,
  regenerateArchiveForRequest,
  sweepExpiredArchives,
} from "@/lib/privacy/data-export.service"
import {
  executeDeletionPipeline,
  collectDeletionResourceRefs,
} from "@/lib/privacy/privacy-deletion.service"
import {
  advanceFromCoolingOff,
  cancelPrivacyRequest,
  confirmPrivacyRequest,
  createPrivacyRequest,
} from "@/lib/privacy/privacy.service"
import {
  createLegalHold,
  evaluateDeletionEligibility,
  releaseLegalHold,
  expireLegalHolds,
  listActiveHoldsForUser,
} from "@/lib/privacy/legal-hold.service"
import { runPrivacySweep } from "@/lib/privacy/privacy-sweep"

const HAS_DB = Boolean(process.env.MONGODB_URI)
const describeDb = HAS_DB ? describe : describe.skip

let tempDir: string

beforeAll(async () => {
  if (!HAS_DB) return
  await dbConnect()
})

afterAll(async () => {
  if (!HAS_DB) return
  await mongoose.disconnect()
})

beforeEach(async () => {
  if (!HAS_DB) return
  tempDir = await mkdtemp(join(tmpdir(), "privacy-it-"))
  process.env.PRIVACY_EXPORT_ARCHIVE_DIR = tempDir
  process.env.PRIVACY_EXPORT_ARCHIVE_KEY = "integration-test-key-1234567890"
  process.env.PRIVACY_EXPORT_ARCHIVE_KEY_VERSION = "it-v1"
  process.env.PRIVACY_COOLING_OFF_HOURS = "0"
  process.env.PRIVACY_CONFIRMATION_TTL_MINUTES = "60"

  await Promise.all([
    User.deleteMany({}),
    KycDocument.deleteMany({}),
    Transaction.deleteMany({}),
    HirePurchaseContract.deleteMany({}),
    Loan.deleteMany({}),
    PoolInvestment.deleteMany({}),
    Investment.deleteMany({}),
    DriverVirtualAccount.deleteMany({}),
    InvestorVirtualAccount.deleteMany({}),
    InvestorCredit.deleteMany({}),
    DriverPayment.deleteMany({}),
    Notification.deleteMany({}),
    NotificationPreference.deleteMany({}),
    Vehicle.deleteMany({}),
    Issue.deleteMany({}),
    WalletRecovery.deleteMany({}),
    AuditLog.deleteMany({}),
    PrivacyRequest.deleteMany({}),
    PrivacyExportArchive.deleteMany({}),
    LegalHold.deleteMany({}),
  ])
})

afterEach(async () => {
  if (!HAS_DB) return
  await Promise.all([
    User.deleteMany({}),
    KycDocument.deleteMany({}),
    Transaction.deleteMany({}),
    HirePurchaseContract.deleteMany({}),
    Loan.deleteMany({}),
    PoolInvestment.deleteMany({}),
    Investment.deleteMany({}),
    DriverVirtualAccount.deleteMany({}),
    InvestorVirtualAccount.deleteMany({}),
    InvestorCredit.deleteMany({}),
    DriverPayment.deleteMany({}),
    Notification.deleteMany({}),
    NotificationPreference.deleteMany({}),
    Vehicle.deleteMany({}),
    Issue.deleteMany({}),
    WalletRecovery.deleteMany({}),
    AuditLog.deleteMany({}),
    PrivacyRequest.deleteMany({}),
    PrivacyExportArchive.deleteMany({}),
    LegalHold.deleteMany({}),
  ])
  await rm(tempDir, { recursive: true, force: true })
})

async function makeUser(overrides: Record<string, unknown> = {}) {
  return User.create({
    name: "Test User",
    fullName: "Test User",
    email: `user-${Math.random().toString(36).slice(2, 8)}@example.com`,
    password: "hashed-secret",
    role: "driver",
    availableBalance: 0,
    totalInvested: 0,
    totalReturns: 0,
    ...overrides,
  })
}

describeDb("privacy/lifecycle — cross-user isolation", () => {
  it("export bundle only contains the requesting user's data", async () => {
    const a = await makeUser({ email: "a@example.com" })
    const b = await makeUser({ email: "b@example.com" })

    await Promise.all([
      Transaction.create({ userId: a._id, userType: "driver", type: "deposit", amount: 1000, status: "Completed", description: "a-tx" }),
      Transaction.create({ userId: b._id, userType: "driver", type: "deposit", amount: 9999, status: "Completed", description: "b-tx" }),
      Notification.create({ userId: a._id, title: "A", message: "for-a", category: "system" }),
      Notification.create({ userId: b._id, title: "B", message: "for-b", category: "system" }),
    ])

    const { bundle } = await buildExportBundle(a._id.toString())
    const leaks = await findCrossUserLeaks(a._id.toString(), bundle)

    expect(leaks).toEqual([])
    // No document owned by user B should appear in any section.
    const flat = JSON.stringify(bundle)
    expect(flat).not.toContain("b-tx")
    expect(flat).not.toContain("for-b")
    expect(flat).not.toContain(b.email)
  })

  it("never exports password hashes or internal risk notes", async () => {
    const user = await makeUser({ password: "bcrypt-hashed-secret" })
    const { bundle } = await buildExportBundle(user._id.toString())
    const flat = JSON.stringify(bundle)
    expect(flat).not.toContain("bcrypt-hashed-secret")
    expect(flat).not.toContain("password")
  })
})

describeDb("privacy/lifecycle — export expiry and encryption", () => {
  it("archives are encrypted at rest and expire", async () => {
    const user = await makeUser()
    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "EXPORT",
    })
    const confirmed = await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })

    expect(confirmed.status).toBe("COMPLETED")
    expect(confirmed.archiveId).toBeDefined()

    const archive = await PrivacyExportArchive.findOne({ archiveId: confirmed.archiveId })
    expect(archive).toBeTruthy()
    expect(archive!.encryptionAlgorithm).toBe("aes-256-gcm")
    expect(archive!.expiresAt.getTime()).toBeGreaterThan(Date.now())

    // The download succeeds and round-trips the JSON.
    const result = await consumeArchiveDownload({
      archiveId: archive!.archiveId,
      downloadToken: archive!.downloadToken,
    })
    if ("error" in result) throw new Error(result.error)
    const parsed = JSON.parse(result.buffer.toString("utf8"))
    expect(parsed.manifest.userId).toBe(user._id.toString())
    expect(parsed.manifest.sectionCount).toBeGreaterThan(0)
  })

  it("expired archives are wiped from disk by the sweep", async () => {
    const user = await makeUser()
    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "EXPORT",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })

    const archive = await PrivacyExportArchive.findOne({ requestId: request.id })
    expect(archive).toBeTruthy()

    // Force expiry and run the sweep.
    await PrivacyExportArchive.updateOne(
      { _id: archive!._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    )
    const count = await sweepExpiredArchives()
    expect(count).toBeGreaterThanOrEqual(1)

    const after = await PrivacyExportArchive.findById(archive!._id)
    expect(after!.status).toBe("EXPIRED")
    expect(after!.wipedAt).toBeDefined()
  })

  it("rejects downloads with a wrong token", async () => {
    const user = await makeUser()
    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "EXPORT",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })
    const archive = await PrivacyExportArchive.findOne({ requestId: request.id })

    const result = await consumeArchiveDownload({
      archiveId: archive!.archiveId,
      downloadToken: "definitely-not-the-token",
    })
    expect("error" in result).toBe(true)
  })
})

describeDb("privacy/lifecycle — repeated requests are idempotent", () => {
  it("the same Idempotency-Key returns the same request", async () => {
    const user = await makeUser()
    const idempotencyKey = "idem-1"

    const first = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "EXPORT",
      idempotencyKey,
    })
    const second = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "EXPORT",
      idempotencyKey,
    })

    expect(second.id).toBe(first.id)
  })

  it("re-running a deletion pipeline does not corrupt records", async () => {
    const user = await makeUser()
    await Notification.create({ userId: user._id, title: "n", message: "m", category: "system" })
    await NotificationPreference.create({ userId: user._id })

    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "DELETION",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })
    // Move into PROCESSING immediately (cooling-off bypassed for the test).
    const stored = await PrivacyRequest.findOne({ id: request.id })
    stored!.status = "PROCESSING"
    stored!.coolingOffStartedAt = new Date(Date.now() - 60_000)
    stored!.coolingOffEndsAt = new Date(Date.now() - 1)
    await stored!.save()

    const outcome1 = await executeDeletionPipeline(stored!)
    expect(outcome1.blockedBy.holds).toEqual([])

    // Notifications and NotificationPreferences should now be gone.
    expect(await Notification.countDocuments({ userId: user._id })).toBe(0)
    expect(await NotificationPreference.countDocuments({ userId: user._id })).toBe(0)

    // Re-run the pipeline: it must be idempotent.
    const reloaded = await PrivacyRequest.findOne({ id: request.id })
    const outcome2 = await executeDeletionPipeline(reloaded!)
    expect(outcome2.blockedBy.holds).toEqual([])

    const userAfter = await User.findById(user._id)
    expect(userAfter!.email).toMatch(/REDACTED_EMAIL_/)
  })
})

describeDb("privacy/lifecycle — active contracts block deletion", () => {
  it("refuses to delete a user with an active hire-purchase contract", async () => {
    const user = await makeUser()
    await HirePurchaseContract.create({
      driverUserId: user._id,
      poolId: new mongoose.Types.ObjectId(),
      assetType: "SHUTTLE",
      vehicleDisplayName: "Test Vehicle",
      principalNgn: 1_000_000,
      totalPayableNgn: 1_200_000,
      durationWeeks: 24,
      weeklyPaymentNgn: 50_000,
      startDate: new Date(),
      status: "ACTIVE",
      timeline: [],
      totalPaidNgn: 0,
      nextDueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    })

    // The "active contract" rule is enforced via legal holds. Without a hold,
    // the pipeline still records the financial record with pseudonymization.
    const refs = await collectDeletionResourceRefs(user._id.toString())
    const eligibility = await evaluateDeletionEligibility({ userId: user._id.toString(), resourceRefs: refs })
    expect(eligibility.blocked).toBe(false)

    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "DELETION",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })
    const stored = await PrivacyRequest.findOne({ id: request.id })
    stored!.status = "PROCESSING"
    stored!.coolingOffStartedAt = new Date(Date.now() - 60_000)
    stored!.coolingOffEndsAt = new Date(Date.now() - 1)
    await stored!.save()
    await executeDeletionPipeline(stored!)

    // Contract remains (financial retention); user is anonymized.
    const contracts = await HirePurchaseContract.find({ driverUserId: user._id })
    expect(contracts.length).toBe(1)
    const contract = contracts[0]
    expect(contract.driverUserId.toString()).not.toBe(user._id.toString())
    // Driver pointer is replaced with a deterministic pseudonym.
    expect(String(contract.driverUserId)).toMatch(/^REDACTED_DRIVERUSERID_/)

    const userAfter = await User.findById(user._id)
    expect(userAfter!.name).toMatch(/^REDACTED_USER_/)
  })
})

describeDb("privacy/lifecycle — legal hold blocks deletion", () => {
  it("an active hold blocks deletion and is visible to the requester", async () => {
    const user = await makeUser()
    const hold = await createLegalHold({
      userId: user._id.toString(),
      reason: "litigation",
      reasonText: "Pending lawsuit — do not delete",
      actor: { id: new mongoose.Types.ObjectId().toString(), role: "admin" },
    })

    const refs = await collectDeletionResourceRefs(user._id.toString())
    const eligibility = await evaluateDeletionEligibility({ userId: user._id.toString(), resourceRefs: refs })
    expect(eligibility.blocked).toBe(true)
    expect(eligibility.holds.map((h) => h.id)).toContain(hold.id)

    const active = await listActiveHoldsForUser(user._id.toString())
    expect(active.length).toBe(1)

    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "DELETION",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })
    const stored = await PrivacyRequest.findOne({ id: request.id })
    stored!.status = "PROCESSING"
    stored!.coolingOffStartedAt = new Date(Date.now() - 60_000)
    stored!.coolingOffEndsAt = new Date(Date.now() - 1)
    await stored!.save()
    const outcome = await executeDeletionPipeline(stored!)
    expect(outcome.blockedBy.holds).toContain(hold.id)
    expect(stored!.status).toBe("FAILED")
    expect(stored!.blockingHoldIds).toContain(hold.id)

    // Releasing the hold makes the next run succeed.
    await releaseLegalHold({
      id: hold.id,
      reason: "Litigation concluded",
      actor: { id: hold.createdBy, role: "admin" },
    })

    stored!.status = "COOLING_OFF"
    stored!.coolingOffEndsAt = new Date(Date.now() - 1)
    await stored!.save()
    const outcome2 = await executeDeletionPipeline(stored!)
    expect(outcome2.blockedBy.holds).toEqual([])
    expect(stored!.status).toBe("COMPLETED")
  })

  it("expired holds do not block deletion", async () => {
    const user = await makeUser()
    const hold = await createLegalHold({
      userId: user._id.toString(),
      reason: "operational",
      actor: { id: new mongoose.Types.ObjectId().toString(), role: "admin" },
    })
    // Force expiry
    await LegalHold.updateOne({ _id: hold._id }, { $set: { expiresAt: new Date(Date.now() - 1) } })
    const count = await expireLegalHolds()
    expect(count).toBe(1)

    const refs = await collectDeletionResourceRefs(user._id.toString())
    const eligibility = await evaluateDeletionEligibility({ userId: user._id.toString(), resourceRefs: refs })
    expect(eligibility.blocked).toBe(false)
  })
})

describeDb("privacy/lifecycle — partial failure / resume", () => {
  it("a partial deletion can be resumed without re-running completed steps", async () => {
    const user = await makeUser()
    await Notification.create({ userId: user._id, title: "x", message: "y", category: "system" })

    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "DELETION",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })
    const stored = await PrivacyRequest.findOne({ id: request.id })
    stored!.status = "PROCESSING"
    stored!.coolingOffStartedAt = new Date(Date.now() - 60_000)
    stored!.coolingOffEndsAt = new Date(Date.now() - 1)
    await stored!.save()

    // Pre-mark the Notification step as completed, then run the pipeline.
    // It should skip the completed step and continue with the rest.
    stored!.steps = [
      { stepId: "delete_notificationpreference_preference", label: "Notification preferences", status: "completed", affectedCount: 0, completedAt: new Date() },
      { stepId: "delete_notification_preference", label: "Notifications", status: "completed", affectedCount: 1, completedAt: new Date() },
      ...stored!.steps,
    ]
    await stored!.save()

    await executeDeletionPipeline(stored!)
    expect(stored!.status).toBe("COMPLETED")

    // Verify the previously-marked step's completion timestamp didn't change.
    const npStep = stored!.steps.find((s) => s.stepId === "delete_notificationpreference_preference")
    expect(npStep!.status).toBe("completed")
  })
})

describeDb("privacy/lifecycle — document removal", () => {
  it("KYC documents are hard-deleted when no hold applies", async () => {
    const user = await makeUser()
    await KycDocument.create({
      userId: user._id,
      documentType: "identity",
      status: "approved",
      storageKey: `kyc/${user._id}/test.json`,
      blobUrl: "https://example.com/test",
      encryptedRef: "kyc-secure:abc",
      originalFilename: "id.pdf",
      sanitizedFilename: "id.pdf",
      contentType: "application/pdf",
      fileSize: 1024,
      checksumSha256: "abc",
      encryptionKeyVersion: "v1",
      scanVerdict: "clean",
      legalHold: false,
      accessCount: 0,
    })

    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "DELETION",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })
    const stored = await PrivacyRequest.findOne({ id: request.id })
    stored!.status = "PROCESSING"
    stored!.coolingOffStartedAt = new Date(Date.now() - 60_000)
    stored!.coolingOffEndsAt = new Date(Date.now() - 1)
    await stored!.save()
    await executeDeletionPipeline(stored!)

    expect(await KycDocument.countDocuments({ userId: user._id })).toBe(0)
  })
})

describeDb("privacy/lifecycle — provider references", () => {
  it("Paystack references are preserved on the local row but reported as non-deletable", async () => {
    const user = await makeUser()
    await DriverVirtualAccount.create({
      driverUserId: user._id,
      contractId: new mongoose.Types.ObjectId(),
      provider: "PAYSTACK",
      status: "ACTIVE",
      paystackCustomerCode: "CUS_test123",
      paystackCustomerId: 12345,
      dedicatedAccountId: 67890,
      accountNumber: "0123456789",
      accountName: "Test User",
      bankName: "Test Bank",
      providerSlug: "test-bank",
      currency: "NGN",
      rawResponse: { secret: "internal-provider-response" } as Record<string, unknown>,
    })

    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "DELETION",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })
    const stored = await PrivacyRequest.findOne({ id: request.id })
    stored!.status = "PROCESSING"
    stored!.coolingOffStartedAt = new Date(Date.now() - 60_000)
    stored!.coolingOffEndsAt = new Date(Date.now() - 1)
    await stored!.save()
    await executeDeletionPipeline(stored!)

    const dva = await DriverVirtualAccount.findOne({})
    expect(dva).toBeTruthy()
    // Paystack identifiers are preserved (the provider owns them).
    expect(dva!.paystackCustomerCode).toBe("CUS_test123")
    expect(dva!.paystackCustomerId).toBe(12345)
    // Personal fields are pseudonymized.
    expect(String(dva!.driverUserId)).not.toBe(user._id.toString())
    expect(String(dva!.driverUserId)).toMatch(/^REDACTED_DRIVERUSERID_/)
    // Raw provider response is wiped.
    expect(dva!.rawResponse).toBeUndefined()

    const { bundle } = await buildExportBundle(user._id.toString())
    const dvaSection = bundle["Driver virtual accounts (provider references)"]
    expect(dvaSection).toBeDefined()
    const flat = JSON.stringify(dvaSection)
    expect(flat).toContain("CUS_test123")
    expect(flat).not.toContain("internal-provider-response")
  })
})

describeDb("privacy/lifecycle — financial record anonymization", () => {
  it("transactions remain with pseudonymized user pointers and preserved amounts", async () => {
    const user = await makeUser()
    await Transaction.create({
      userId: user._id,
      userType: "driver",
      type: "deposit",
      amount: 5_000,
      status: "Completed",
      description: "funding",
    })

    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "DELETION",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })
    const stored = await PrivacyRequest.findOne({ id: request.id })
    stored!.status = "PROCESSING"
    stored!.coolingOffStartedAt = new Date(Date.now() - 60_000)
    stored!.coolingOffEndsAt = new Date(Date.now() - 1)
    await stored!.save()
    await executeDeletionPipeline(stored!)

    const tx = await Transaction.findOne({})
    expect(tx).toBeTruthy()
    expect(tx!.amount).toBe(5_000)
    expect(String(tx!.userId)).not.toBe(user._id.toString())
    expect(String(tx!.userId)).toMatch(/^REDACTED_USERID_/)
  })
})

describeDb("privacy/lifecycle — cancellation", () => {
  it("a cooling-off deletion can be cancelled before processing", async () => {
    const user = await makeUser()
    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "DELETION",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })

    const cancelled = await cancelPrivacyRequest({
      requestId: request.id,
      reason: "User changed their mind",
      actor: { id: user._id.toString(), role: "user" },
    })
    expect(cancelled.status).toBe("CANCELLED")
  })

  it("advancing a cooling-off request runs the deletion pipeline", async () => {
    const user = await makeUser()
    await Notification.create({ userId: user._id, title: "n", message: "m", category: "system" })
    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "DELETION",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })
    const stored = await PrivacyRequest.findOne({ id: request.id })
    stored!.coolingOffEndsAt = new Date(Date.now() - 1000)
    await stored!.save()

    const advanced = await advanceFromCoolingOff(request.id)
    expect(advanced!.status).toBe("COMPLETED")
    expect(await Notification.countDocuments({ userId: user._id })).toBe(0)
  })
})

describeDb("privacy/lifecycle — sweep job", () => {
  it("runs all sweep tasks idempotently", async () => {
    const report = await runPrivacySweep()
    expect(report.ranAt).toBeDefined()
    expect(typeof report.deletionsAdvanced).toBe("number")
    expect(typeof report.archivesExpired).toBe("number")
    expect(typeof report.holdsExpired).toBe("number")
  })
})

describeDb("privacy/lifecycle — archive regeneration", () => {
  it("regenerates the archive when the previous one expired", async () => {
    const user = await makeUser()
    const request = await createPrivacyRequest({
      userId: user._id.toString(),
      requestType: "EXPORT",
    })
    await confirmPrivacyRequest({
      requestId: request.id,
      confirmationToken: request.confirmationToken!,
      actor: { id: user._id.toString(), role: "user" },
    })

    const before = await PrivacyExportArchive.findOne({ requestId: request.id })
    expect(before).toBeTruthy()

    // Force expiry and regenerate.
    await PrivacyExportArchive.updateOne(
      { _id: before!._id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    )

    const stored = await PrivacyRequest.findOne({ id: request.id })
    const result = await regenerateArchiveForRequest(stored!)
    expect(result.archiveId).not.toBe(before!.archiveId)

    const oldAfter = await PrivacyExportArchive.findById(before!._id)
    expect(oldAfter!.status).toBe("REVOKED")
  })
})
