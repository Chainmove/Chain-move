/**
 * Unit tests for the privacy data map and retention policy.
 *
 * These tests don't require a database connection — they validate the
 * declarations that drive both the export and deletion pipelines.
 */

import { describe, it, expect } from "vitest"

import {
  PRIVACY_DATA_MAP,
  RETENTION_POLICY_VERSION,
  getEntriesByModel,
  getHardDeleteEntries,
  getRetainedCategories,
  listProviderReferences,
} from "@/lib/privacy/data-map"

describe("privacy/data-map", () => {
  it("exposes a retention policy version constant", () => {
    expect(typeof RETENTION_POLICY_VERSION).toBe("string")
    expect(RETENTION_POLICY_VERSION.length).toBeGreaterThan(0)
  })

  it("contains at least one entry per personal-data category in active use", () => {
    const seenCategories = new Set(PRIVACY_DATA_MAP.map((entry) => entry.category))
    expect(seenCategories.has("contact_pii")).toBe(true)
    expect(seenCategories.has("financial_record")).toBe(true)
    expect(seenCategories.has("audit_record")).toBe(true)
    expect(seenCategories.has("kyc_document")).toBe(true)
  })

  it("never includes auth secrets in the exportable fields", () => {
    const offenders: string[] = []
    for (const entry of PRIVACY_DATA_MAP) {
      if (entry.exportInclusion === "exclude") continue
      for (const field of entry.exportableFields || []) {
        if (["password", "rawResponse", "privyUserId"].includes(field)) {
          offenders.push(`${entry.model}.${field}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("never includes internal risk notes in exportable fields", () => {
    const offenders: string[] = []
    for (const entry of PRIVACY_DATA_MAP) {
      for (const field of entry.exportableFields || []) {
        if (/risk|internal|admin[_ ]?note/i.test(field)) {
          offenders.push(`${entry.model}.${field}`)
        }
      }
    }
    expect(offenders).toEqual([])
  })

  it("exposes hard-delete entries for preferences and KYC documents", () => {
    const hard = getHardDeleteEntries().map((e) => e.model)
    expect(hard).toContain("NotificationPreference")
    expect(hard).toContain("Notification")
    expect(hard).toContain("KycDocument")
  })

  it("never hard-deletes the User record (kept as anonymized tombstone)", () => {
    const hard = getHardDeleteEntries().map((e) => e.model)
    expect(hard).not.toContain("User")
  })

  it("includes authentication fields in the User anonymization entry", () => {
    const userEntries = getEntriesByModel("User")
    expect(userEntries.length).toBeGreaterThan(0)
    const profile = userEntries.find((e) => e.category === "contact_pii")
    expect(profile).toBeDefined()
    expect(profile!.personalFields).toContain("password")
    expect(profile!.personalFields).toContain("privyUserId")
    expect(profile!.deletionStrategy).toBe("anonymize")
  })

  it("keeps financial and audit records retained by regulation", () => {
    expect(getRetainedCategories()).toContain("financial_record")
    expect(getRetainedCategories()).toContain("audit_record")
  })

  it("lists provider references that cannot be auto-deleted", () => {
    const refs = listProviderReferences()
    expect(refs.length).toBeGreaterThan(0)
    const paystack = refs.filter((r) => r.provider === "PAYSTACK")
    expect(paystack.length).toBeGreaterThan(0)
    for (const ref of paystack) {
      expect(ref.deletable).toBe(false)
    }
  })

  it("can lookup entries by model name", () => {
    expect(getEntriesByModel("User").length).toBeGreaterThan(0)
    expect(getEntriesByModel("user").length).toBe(getEntriesByModel("User").length)
    expect(getEntriesByModel("NoSuchModel")).toEqual([])
  })

  it("ensures KYC entries cascade to storage", () => {
    const kyc = getEntriesByModel("KycDocument")
    expect(kyc.length).toBeGreaterThan(0)
    for (const entry of kyc) {
      expect(entry.cascadesToStorage).toBe(true)
    }
  })

  it("ensures audit records cannot be hard deleted", () => {
    const audit = getEntriesByModel("AuditLog")
    expect(audit.length).toBeGreaterThan(0)
    for (const entry of audit) {
      expect(entry.deletionStrategy).not.toBe("hard_delete")
    }
  })
})
