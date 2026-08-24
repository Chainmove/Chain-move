/**
 * Personal-data inventory and retention policy for ChainMove.
 *
 * The matrix below is the *single source of truth* for what personal data
 * exists, how long it must be retained, and what happens when a user exercises
 * their right to erasure / export. Every entry MUST be evaluated by:
 *
 *   1. `lib/privacy/data-export.service.ts` (export builder) — picks fields
 *      whose category is `exportable` or `exportable_pseudonymized`.
 *   2. `lib/privacy/privacy-deletion.service.ts` (anonymizer / hard delete)
 *      — applies `deletionStrategy` per entry.
 *   3. `lib/privacy/legal-hold.service.ts` — refuses deletion when an ACTIVE
 *      hold references the resource.
 *
 * Categories
 * ----------
 * - `essential_identity`: required for the user record to remain functional
 *   (e.g. role, account creation date). Not exported verbatim; only summary.
 * - `contact_pii`: name, email, phone, address. Exportable; on deletion
 *   anonymized unless retained by a hold.
 * - `auth_pii`: passwords (hashed), session identifiers, MFA factors.
 *   Not exportable verbatim (already sensitive); cleared on deletion.
 * - `wallet_pii`: linked wallet addresses. Exportable; cleared on deletion
 *   when no on-chain history depends on them.
 * - `provider_reference`: external provider IDs (Paystack, Privy, Stellar).
 *   Exportable as opaque identifiers; cannot be auto-deleted (provider owns
 *   the record).
 * - `kyc_document`: stored private blobs. Exportable as references (the file
 *   itself is never included — see deletion-limitations.md); removed when
 *   no hold applies.
 * - `financial_record`: investment, loan, repayment, transaction rows.
 *   Retained for the regulatory window (default 7 years). Personal fields
 *   are pseudonymized; monetary fields are kept verbatim.
 * - `audit_record`: tamper-evident audit events. Retained for the regulatory
 *   window. Personal fields are pseudonymized but never deleted.
 * - `preference`: notification preferences, dashboard state. Cleared on
 *   deletion.
 * - `derived_metrics`: aggregate balances, totals. Recomputed from financial
 *   records — cleared when the user is anonymized.
 *
 * `deletionStrategy` controls what happens for each entry:
 *
 * - `hard_delete`: the entire document is removed.
 * - `anonymize`: personal fields are replaced with deterministic placeholders;
 *   the document is preserved for referential integrity.
 * - `pseudonymize`: like `anonymize`, but a stable, salted alias is used so
 *   related records stay joinable for audit purposes.
 * - `retain`: the document is never deleted (e.g. audit log); personal fields
 *   are pseudonymized when possible.
 */

export type PrivacyCategory =
  | "essential_identity"
  | "contact_pii"
  | "auth_pii"
  | "wallet_pii"
  | "provider_reference"
  | "kyc_document"
  | "financial_record"
  | "audit_record"
  | "preference"
  | "derived_metrics"

export type DeletionStrategy = "hard_delete" | "anonymize" | "pseudonymize" | "retain"

export type ExportInclusion = "include" | "include_pseudonymized" | "reference_only" | "exclude"

/**
 * One row in the data map. Each model can have multiple rows — for example,
 * `User` has separate rows for `contact_pii` (name/email/phone) and
 * `auth_pii` (password/session).
 */
export interface PrivacyDataMapEntry {
  /** Display label, used in export manifests and docs. */
  label: string
  /** Mongoose model name (lowercase). */
  model: string
  /** User field used to filter documents owned by the requesting user. */
  ownerField: string
  /** When ownerField is an array of ids, expand on this nested field. */
  arrayOwnerField?: string
  /** Personal data category for this entry. */
  category: PrivacyCategory
  /** Whether the entry is eligible for export, and at what fidelity. */
  exportInclusion: ExportInclusion
  /** What happens when the user is deleted. */
  deletionStrategy: DeletionStrategy
  /** Hard minimum retention window (days) before deletion can proceed. */
  minimumRetentionDays?: number
  /**
   * Hard retention window (days) AFTER which the entry becomes eligible for
   * automatic deletion by the retention sweep job. NULL means "indefinite".
   */
  automaticRetentionDays?: number | null
  /**
   * Personal fields within the model that should be replaced with placeholders
   * during anonymization. Other fields are left untouched.
   */
  personalFields: string[]
  /**
   * Personal fields that are safe to include in a user-facing export. Anything
   * not listed here is omitted from the export bundle (e.g. password hashes,
   * raw provider responses, internal risk notes).
   */
  exportableFields?: string[]
  /**
   * Free-form documentation note that surfaces in the runbook and the
   * deletion-limitations document.
   */
  notes?: string
  /** Whether a hard delete must be coordinated with the storage layer. */
  cascadesToStorage?: boolean
  /**
   * Provider reference fields that cannot be auto-deleted but should be
   * reported in the export and deletion-limitations documents.
   */
  providerReferences?: { provider: string; field: string; deletable: boolean }[]
}

export const RETENTION_POLICY_VERSION = "v1"

export const RETENTION_AUTOMATIC_DEFAULTS_DAYS = {
  kyc_document: 365 * 7,
  financial_record: 365 * 7,
  audit_record: 365 * 7,
} as const

export const PRIVACY_DATA_MAP: PrivacyDataMapEntry[] = [
  {
    label: "User profile (identity, contact & authentication)",
    model: "User",
    ownerField: "_id",
    category: "contact_pii",
    exportInclusion: "include",
    deletionStrategy: "anonymize",
    personalFields: [
      "name",
      "fullName",
      "email",
      "phoneNumber",
      "address",
      "bio",
      "notifications",
      "password",
      "privyUserId",
    ],
    exportableFields: [
      "name",
      "fullName",
      "email",
      "phoneNumber",
      "address",
      "bio",
      "role",
      "walletAddress",
      "walletaddress",
      "stellarPublicKey",
      "availableBalance",
      "totalInvested",
      "totalReturns",
      "createdAt",
      "updatedAt",
    ],
    notes:
      "Account is preserved as a tombstone (anonymized) so that financial records remain referentially valid. Password hash and Privy link are nulled out so the user can no longer authenticate.",
  },
  {
    label: "Notification preferences",
    model: "NotificationPreference",
    ownerField: "userId",
    category: "preference",
    exportInclusion: "include",
    deletionStrategy: "hard_delete",
    personalFields: ["locale"],
    notes: "Cleared entirely — preference data has no regulatory retention need.",
  },
  {
    label: "KYC documents (metadata only)",
    model: "KycDocument",
    ownerField: "userId",
    category: "kyc_document",
    exportInclusion: "reference_only",
    deletionStrategy: "hard_delete",
    minimumRetentionDays: 365 * 5,
    automaticRetentionDays: RETENTION_AUTOMATIC_DEFAULTS_DAYS.kyc_document,
    personalFields: ["originalFilename", "sanitizedFilename"],
    exportableFields: [
      "documentType",
      "status",
      "originalFilename",
      "sanitizedFilename",
      "contentType",
      "fileSize",
      "checksumSha256",
      "encryptionKeyVersion",
      "createdAt",
      "deletedAt",
    ],
    cascadesToStorage: true,
    notes:
      "The encrypted blob itself is NOT included in the export. Only metadata is referenced; the user is directed to re-download from storage if they need the file.",
  },
  {
    label: "Vehicles (driver reference)",
    model: "Vehicle",
    ownerField: "driverId",
    category: "derived_metrics",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    personalFields: ["driverId"],
    notes:
      "Vehicle record is kept (referential integrity) but the driver pointer is replaced with a pseudonym.",
  },
  {
    label: "Loans (driver reference)",
    model: "Loan",
    ownerField: "driverId",
    category: "financial_record",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    minimumRetentionDays: 365 * 5,
    automaticRetentionDays: RETENTION_AUTOMATIC_DEFAULTS_DAYS.financial_record,
    personalFields: ["driverId", "adminNotes", "purpose", "collateral"],
    exportableFields: [
      "requestedAmount",
      "totalAmountToPayBack",
      "totalFunded",
      "loanTerm",
      "monthlyPayment",
      "weeklyPayment",
      "interestRate",
      "status",
      "submittedDate",
      "approvedDate",
      "reviewedDate",
    ],
  },
  {
    label: "Investments (investor reference)",
    model: "Investment",
    ownerField: "investorId",
    category: "financial_record",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    minimumRetentionDays: 365 * 5,
    automaticRetentionDays: RETENTION_AUTOMATIC_DEFAULTS_DAYS.financial_record,
    personalFields: ["investorId"],
    exportableFields: ["amount", "status", "monthlyReturn", "date"],
  },
  {
    label: "Pool investments",
    model: "PoolInvestment",
    ownerField: "userId",
    category: "financial_record",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    minimumRetentionDays: 365 * 5,
    automaticRetentionDays: RETENTION_AUTOMATIC_DEFAULTS_DAYS.financial_record,
    personalFields: ["userId"],
    exportableFields: ["amountNgn", "ownershipUnits", "ownershipBps", "status", "createdAt"],
  },
  {
    label: "Hire purchase contracts",
    model: "HirePurchaseContract",
    ownerField: "driverUserId",
    category: "financial_record",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    minimumRetentionDays: 365 * 5,
    automaticRetentionDays: RETENTION_AUTOMATIC_DEFAULTS_DAYS.financial_record,
    personalFields: ["driverUserId"],
    exportableFields: [
      "principalNgn",
      "depositNgn",
      "totalPayableNgn",
      "durationWeeks",
      "weeklyPaymentNgn",
      "totalPaidNgn",
      "status",
      "startDate",
    ],
  },
  {
    label: "Driver payments",
    model: "DriverPayment",
    ownerField: "driverUserId",
    category: "financial_record",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    minimumRetentionDays: 365 * 5,
    automaticRetentionDays: RETENTION_AUTOMATIC_DEFAULTS_DAYS.financial_record,
    personalFields: ["driverUserId", "payerEmail"],
    exportableFields: [
      "amountNgn",
      "appliedAmountNgn",
      "method",
      "paystackRef",
      "status",
      "confirmedAt",
    ],
  },
  {
    label: "Driver virtual accounts (provider references)",
    model: "DriverVirtualAccount",
    ownerField: "driverUserId",
    category: "provider_reference",
    exportInclusion: "reference_only",
    deletionStrategy: "pseudonymize",
    personalFields: ["driverUserId", "accountName", "rawResponse"],
    exportableFields: [
      "provider",
      "status",
      "paystackCustomerCode",
      "paystackCustomerId",
      "dedicatedAccountId",
      "accountNumber",
      "bankName",
      "providerSlug",
      "currency",
    ],
    cascadesToStorage: false,
    providerReferences: [
      { provider: "PAYSTACK", field: "paystackCustomerCode", deletable: false },
      { provider: "PAYSTACK", field: "paystackCustomerId", deletable: false },
      { provider: "PAYSTACK", field: "dedicatedAccountId", deletable: false },
    ],
    notes:
      "Paystack customer/account identifiers cannot be auto-deleted because the provider owns the record. The local row is pseudonymized.",
  },
  {
    label: "Investor virtual accounts (provider references)",
    model: "InvestorVirtualAccount",
    ownerField: "investorUserId",
    category: "provider_reference",
    exportInclusion: "reference_only",
    deletionStrategy: "pseudonymize",
    personalFields: ["investorUserId", "accountName", "rawResponse"],
    exportableFields: [
      "provider",
      "status",
      "paystackCustomerCode",
      "paystackCustomerId",
      "dedicatedAccountId",
      "accountNumber",
      "bankName",
      "providerSlug",
      "currency",
    ],
    providerReferences: [
      { provider: "PAYSTACK", field: "paystackCustomerCode", deletable: false },
      { provider: "PAYSTACK", field: "paystackCustomerId", deletable: false },
      { provider: "PAYSTACK", field: "dedicatedAccountId", deletable: false },
    ],
    notes:
      "Paystack customer/account identifiers cannot be auto-deleted. The local row is pseudonymized.",
  },
  {
    label: "Investor credits",
    model: "InvestorCredit",
    ownerField: "investorUserId",
    category: "financial_record",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    minimumRetentionDays: 365 * 5,
    automaticRetentionDays: RETENTION_AUTOMATIC_DEFAULTS_DAYS.financial_record,
    personalFields: ["investorUserId"],
    exportableFields: ["amountNgn", "status", "createdAt"],
  },
  {
    label: "Transactions",
    model: "Transaction",
    ownerField: "userId",
    category: "financial_record",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    minimumRetentionDays: 365 * 5,
    automaticRetentionDays: RETENTION_AUTOMATIC_DEFAULTS_DAYS.financial_record,
    personalFields: ["userId"],
    exportableFields: [
      "type",
      "amount",
      "currency",
      "method",
      "status",
      "description",
      "timestamp",
    ],
  },
  {
    label: "Notifications",
    model: "Notification",
    ownerField: "userId",
    category: "preference",
    exportInclusion: "include",
    deletionStrategy: "hard_delete",
    personalFields: ["title", "message", "link"],
    exportableFields: ["title", "message", "category", "priority", "link", "read", "timestamp"],
    notes: "Removed after the user is anonymized.",
  },
  {
    label: "Issues reported by user",
    model: "Issue",
    ownerField: "reportedByUserId",
    category: "preference",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    personalFields: ["reportedByUserId", "reportedByLabel", "notes"],
    exportableFields: ["title", "description", "issueType", "severity", "status", "createdAt"],
  },
  {
    label: "Wallet recovery requests",
    model: "WalletRecovery",
    ownerField: "userId",
    category: "auth_pii",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    personalFields: ["userId", "highRiskReviewNote", "disputeReason"],
    exportableFields: ["network", "state", "oldWalletAddress", "newWalletAddress", "createdAt"],
    notes:
      "Old/new wallet addresses are kept for audit (the value is on-chain), but the user pointer is pseudonymized.",
  },
  {
    label: "Audit log entries",
    model: "AuditLog",
    ownerField: "actorId",
    category: "audit_record",
    exportInclusion: "include_pseudonymized",
    deletionStrategy: "pseudonymize",
    minimumRetentionDays: 365 * 5,
    automaticRetentionDays: RETENTION_AUTOMATIC_DEFAULTS_DAYS.audit_record,
    personalFields: ["actorId", "metadata"],
    exportableFields: ["action", "targetType", "targetId", "status", "createdAt"],
    notes:
      "Audit records are NEVER deleted. Personal fields are pseudonymized so the chain of custody stays valid.",
  },
]

/**
 * Returns entries whose category is "essential_identity" — these are NOT
 * affected by deletion and are never included in exports.
 */
export function getEssentialIdentityEntries(): PrivacyDataMapEntry[] {
  return PRIVACY_DATA_MAP.filter((entry) => entry.category === "essential_identity")
}

/**
 * Returns entries for a given model name (case insensitive).
 */
export function getEntriesByModel(modelName: string): PrivacyDataMapEntry[] {
  const needle = modelName.toLowerCase()
  return PRIVACY_DATA_MAP.filter((entry) => entry.model.toLowerCase() === needle)
}

/**
 * Returns entries whose `deletionStrategy` is "hard_delete". These are the
 * collections where the entire document is removed on user erasure.
 */
export function getHardDeleteEntries(): PrivacyDataMapEntry[] {
  return PRIVACY_DATA_MAP.filter((entry) => entry.deletionStrategy === "hard_delete")
}

/**
 * Returns entries whose category is retained by regulation. These documents
 * survive deletion but their personal fields are pseudonymized.
 */
export function getRetainedCategories(): PrivacyCategory[] {
  return ["financial_record", "audit_record"]
}

/**
 * Returns the list of categories that contain provider references the user
 * should be told about in the deletion-limitations document.
 */
export function listProviderReferences(): {
  model: string
  field: string
  provider: string
  deletable: boolean
}[] {
  const refs: { model: string; field: string; provider: string; deletable: boolean }[] = []
  for (const entry of PRIVACY_DATA_MAP) {
    for (const ref of entry.providerReferences || []) {
      refs.push({ model: entry.model, ...ref })
    }
  }
  return refs
}
