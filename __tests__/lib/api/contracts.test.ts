// @vitest-environment node
import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  apiContracts,
  DriverVirtualAccountResponseSchema,
  FleetDocumentCreateRequestSchema,
  InvestmentListResponseSchema,
  KycRequestListResponseSchema,
  KycRequestSchema,
  LedgerListQuerySchema,
  LedgerListResponseSchema,
  PaymentInitializeRequestSchema,
  PoolCreateRequestSchema,
  PoolInvestmentRequestSchema,
  PoolInvestmentResponseSchema,
  WalletSummaryResponseSchema,
} from "@/lib/api/contracts"
import { assertNoForbiddenFields } from "@/lib/api/serialization"

/**
 * Consumer contract tests.
 *
 * Each case pins a promise a client depends on: what a request must accept,
 * what a response must guarantee, and what must never appear in either.
 */

const money = (amountMajor: number, currency = "NGN") => ({
  currency,
  amountMinor: Math.round(amountMajor * 100),
  amountMajor,
})

describe("registry integrity", () => {
  it("gives every contract a unique operation id", () => {
    const ids = apiContracts.map((contract) => contract.operationId)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it("gives every method/path pair exactly one contract", () => {
    const keys = apiContracts.map((contract) => `${contract.method} ${contract.path}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it("documents the standard error statuses on every non-webhook endpoint", () => {
    for (const contract of apiContracts) {
      if (contract.auth === "public" || contract.auth === "webhook") continue

      expect(contract.errors, `${contract.operationId} must document 401`).toContain(401)
      expect(contract.errors, `${contract.operationId} must document 500`).toContain(500)
    }
  })

  it("declares a body schema for every mutating endpoint", () => {
    for (const contract of apiContracts) {
      if (contract.method === "GET" || contract.method === "DELETE") continue
      expect(contract.body, `${contract.operationId} must declare a request body`).toBeDefined()
    }
  })

  it("keeps forbidden fields out of every published example", () => {
    for (const contract of apiContracts) {
      if (contract.example) expect(() => assertNoForbiddenFields(contract.example)).not.toThrow()
      if (contract.requestExample) {
        expect(() => assertNoForbiddenFields(contract.requestExample)).not.toThrow()
      }
    }
  })

  it("validates every published example against its own response schema", () => {
    for (const contract of apiContracts) {
      if (!contract.example) continue

      const result = contract.response.safeParse(contract.example)
      expect(result.success, `${contract.operationId} example does not match its schema`).toBe(true)
    }
  })

  it("validates every published request example against its own body schema", () => {
    for (const contract of apiContracts) {
      if (!contract.requestExample || !contract.body) continue

      const result = contract.body.safeParse(contract.requestExample)
      expect(result.success, `${contract.operationId} request example does not match`).toBe(true)
    }
  })
})

describe("payments contract", () => {
  it("rejects a client-supplied exchange rate", () => {
    // Accepting a rate from the client would let a caller set their own
    // conversion; rates are server-side only.
    expect(PaymentInitializeRequestSchema.safeParse({ amountNgn: 1000, exchangeRate: 1500 }).success).toBe(
      false,
    )
  })

  it("requires a positive, bounded amount", () => {
    expect(PaymentInitializeRequestSchema.safeParse({ amountNgn: 0 }).success).toBe(false)
    expect(PaymentInitializeRequestSchema.safeParse({ amountNgn: -100 }).success).toBe(false)
    expect(PaymentInitializeRequestSchema.safeParse({ amountNgn: 1e12 }).success).toBe(false)
    expect(PaymentInitializeRequestSchema.safeParse({ amountNgn: 25000 }).success).toBe(true)
  })

  it("coerces a numeric string from a form submission", () => {
    expect(PaymentInitializeRequestSchema.parse({ amountNgn: "25000" }).amountNgn).toBe(25000)
  })

  it("rejects a malformed email", () => {
    expect(PaymentInitializeRequestSchema.safeParse({ amountNgn: 100, email: "nope" }).success).toBe(false)
  })
})

describe("webhook contract", () => {
  // This route is documented but not built on `defineRoute`, so nothing enforces
  // the schema at runtime. These cases pin the shapes the handler in
  // app/api/payments/webhook/route.ts actually returns, so the published
  // contract cannot drift away from it unnoticed.
  const schema = apiContracts.find((contract) => contract.operationId === "paystackWebhook")!.response

  it("accepts every acknowledgement the handler returns", () => {
    for (const payload of [
      { status: "ignored" },
      { status: "ignored", reason: "No local dedicated virtual account matched." },
      { status: "success", type: "driver_repayment", alreadyProcessed: false },
      { status: "success", type: "wallet_funding", alreadyProcessed: true },
    ]) {
      expect(schema.safeParse(payload).success, JSON.stringify(payload)).toBe(true)
    }
  })

  it("rejects an undocumented acknowledgement status", () => {
    expect(schema.safeParse({ status: "retry" }).success).toBe(false)
  })
})

describe("investment contract", () => {
  it("requires an amount and accepts an idempotency reference", () => {
    expect(PoolInvestmentRequestSchema.safeParse({}).success).toBe(false)
    expect(
      PoolInvestmentRequestSchema.safeParse({
        amountNgn: 5000,
        txRef: "ref-1",
        consentAcceptanceId: "consent_acc_1",
      }).success,
    ).toBe(true)
  })

  it("rejects undeclared request fields", () => {
    expect(
      PoolInvestmentRequestSchema.safeParse({
        amountNgn: 5000,
        consentAcceptanceId: "consent_acc_1",
        ownershipBps: 9999,
      }).success,
    ).toBe(false)
  })

  it("strips fields the response contract does not declare", () => {
    const parsed = PoolInvestmentResponseSchema.parse({
      success: true,
      investment: {
        poolId: "665f1a2b3c4d5e6f70819203",
        userId: "665f1a2b3c4d5e6f70819204",
        amount: money(50000),
        ownershipUnits: 10,
        ownershipBps: 200,
        txRef: "ref-1",
        consentAcceptanceId: "consent_acc_1",
        acceptedDocumentSetHash: "a".repeat(64),
        poolStatus: "OPEN",
        currentRaised: money(50000),
        targetAmount: money(2500000),
        investorCount: 1,
        userBalance: money(5000),
        passwordHash: "$2b$10$leaked",
        __v: 3,
      },
    })

    expect("passwordHash" in parsed.investment).toBe(false)
    expect("__v" in parsed.investment).toBe(false)
    expect(() => assertNoForbiddenFields(parsed)).not.toThrow()
  })

  it("serializes money as exact minor units rather than a float", () => {
    const parsed = PoolInvestmentResponseSchema.parse({
      success: true,
      investment: {
        poolId: "665f1a2b3c4d5e6f70819203",
        userId: "665f1a2b3c4d5e6f70819204",
        amount: money(50000),
        ownershipUnits: 10,
        ownershipBps: 200,
        txRef: "ref-1",
        consentAcceptanceId: "consent_acc_1",
        acceptedDocumentSetHash: "a".repeat(64),
        poolStatus: "OPEN",
        currentRaised: money(50000),
        targetAmount: money(2500000),
        investorCount: 1,
        userBalance: money(5000),
      },
    })

    expect(parsed.investment.amount.amountMinor).toBe(5000000)
    expect(parsed.investment.amount.currency).toBe("NGN")
  })

  it("constrains pool creation to known asset types", () => {
    expect(PoolCreateRequestSchema.safeParse({ assetType: "KEKE" }).success).toBe(true)
    expect(PoolCreateRequestSchema.safeParse({ assetType: "YACHT" }).success).toBe(false)
  })

  it("requires investment amounts to be present in list responses", () => {
    const result = InvestmentListResponseSchema.safeParse({
      success: true,
      investments: [{ id: "665f1a2b3c4d5e6f70819203", status: "Active" }],
    })

    expect(result.success).toBe(false)
  })
})

describe("wallet contract", () => {
  it("reports an unlinked wallet as null rather than omitting the field", () => {
    const parsed = WalletSummaryResponseSchema.parse({
      success: true,
      wallet: { internalBalance: money(0), walletAddress: null },
      transactions: [],
    })

    expect(parsed.wallet.walletAddress).toBeNull()
  })

  it("rejects a transaction type outside the documented set", () => {
    const result = WalletSummaryResponseSchema.safeParse({
      success: true,
      wallet: { internalBalance: money(0), walletAddress: null },
      transactions: [
        {
          id: "665f1a2b3c4d5e6f70819203",
          type: "mystery_movement",
          amount: money(1),
          status: "Completed",
          method: null,
          description: "",
          reference: null,
          timestamp: "2026-01-30T09:15:00.000Z",
        },
      ],
    })

    expect(result.success).toBe(false)
  })

  it("requires ISO 8601 timestamps", () => {
    const build = (timestamp: string) =>
      WalletSummaryResponseSchema.safeParse({
        success: true,
        wallet: { internalBalance: money(0), walletAddress: null },
        transactions: [
          {
            id: "665f1a2b3c4d5e6f70819203",
            type: "deposit",
            amount: money(1),
            status: "Completed",
            method: null,
            description: "",
            reference: null,
            timestamp,
          },
        ],
      })

    expect(build("2026-01-30T09:15:00.000Z").success).toBe(true)
    expect(build("30/01/2026").success).toBe(false)
  })
})

describe("driver contract", () => {
  it("does not publish the mock harness reference", () => {
    const parsed = DriverVirtualAccountResponseSchema.parse({
      success: true,
      virtualAccount: {
        accountNumber: "0123456789",
        accountName: "ChainMove / Driver",
        bankName: "Test Bank",
        providerSlug: "test-bank",
        status: "active",
        contractId: "contract-1",
        remainingBalance: money(120000),
        nextPaymentAmount: money(15000),
        isMock: true,
        mockReference: "mock_ref_should_not_ship",
      },
    })

    expect("mockReference" in parsed.virtualAccount).toBe(false)
  })
})

describe("fleet contract", () => {
  it("requires the fields the old handler only checked ad hoc", () => {
    expect(FleetDocumentCreateRequestSchema.safeParse({ title: "Insurance" }).success).toBe(false)
  })

  it("rejects an unknown document type", () => {
    const base = {
      vehicleId: "665f1a2b3c4d5e6f70819203",
      title: "Insurance",
      issueDate: "2026-01-01",
      expiryDate: "2027-01-01",
    }

    expect(FleetDocumentCreateRequestSchema.safeParse({ ...base, documentType: "smuggled" }).success).toBe(
      false,
    )
    expect(
      FleetDocumentCreateRequestSchema.safeParse({ ...base, documentType: "roadworthiness" }).success,
    ).toBe(true)
  })

  it("rejects an unparsable date instead of storing an Invalid Date", () => {
    expect(
      FleetDocumentCreateRequestSchema.safeParse({
        vehicleId: "665f1a2b3c4d5e6f70819203",
        documentType: "roadworthiness",
        title: "Roadworthiness",
        issueDate: "whenever",
        expiryDate: "2027-01-01",
      }).success,
    ).toBe(false)
  })
})

describe("reporting contract", () => {
  it("defaults pagination and accepts documented filters", () => {
    const parsed = LedgerListQuerySchema.parse({ status: "Completed", type: "repayment" })

    expect(parsed).toMatchObject({ page: 1, pageSize: 20, status: "Completed", type: "repayment" })
  })

  it("rejects a filter value outside the documented enum", () => {
    expect(LedgerListQuerySchema.safeParse({ status: "Reversed" }).success).toBe(false)
    expect(LedgerListQuerySchema.safeParse({ reconciliation: "maybe" }).success).toBe(false)
  })

  it("rejects a non-ObjectId user filter", () => {
    expect(LedgerListQuerySchema.safeParse({ userId: "'; drop collection" }).success).toBe(false)
  })

  it("no longer exposes raw provider metadata on ledger entries", () => {
    const entry = {
      id: "665f1a2b3c4d5e6f70819203",
      userId: "665f1a2b3c4d5e6f70819204",
      userType: "investor",
      userName: null,
      userEmail: null,
      type: "wallet_funding",
      direction: "credit",
      amount: money(25000),
      originalAmount: null,
      exchangeRate: null,
      method: "paystack",
      reference: "cm_wallet_1",
      description: "Wallet funding",
      status: "Completed",
      reconciliation: "reconciled",
      relatedId: null,
      timestamp: "2026-01-30T09:15:00.000Z",
      metadata: { authorization: { last4: "4081" }, ip_address: "10.0.0.5" },
    }

    const parsed = LedgerListResponseSchema.parse({
      success: true,
      scope: "self",
      transactions: [entry],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrevious: true },
      summary: {
        totalCount: 1,
        totalAmount: money(25000),
        completedCount: 1,
        completedAmount: money(25000),
        pendingCount: 0,
        pendingAmount: money(0),
        failedCount: 0,
        failedAmount: money(0),
        duplicateCount: 0,
      },
    })

    expect("metadata" in parsed.transactions[0]).toBe(false)
    expect(JSON.stringify(parsed)).not.toContain("4081")
  })
})

describe("admin KYC contract", () => {
  const request = {
    id: "665f1a2b3c4d5e6f70819203",
    role: "driver",
    name: "A Driver",
    email: "driver@example.test",
    phoneNumber: null,
    kycStatus: "pending",
    documentCount: 1,
    documentReferences: ["kycdoc_v1_abc"],
    rejectionReason: null,
    physicalMeetingStatus: null,
    physicalMeetingDate: null,
    updatedAt: "2026-01-30T09:15:00.000Z",
  }

  it("publishes document references so a reviewer can open each document", () => {
    // The references are opaque handles, not bearer capabilities:
    // GET /api/kyc-documents re-authorizes every one. Reducing them to a count
    // would break the review workflow without adding protection.
    expect(KycRequestSchema.shape).toHaveProperty("documentReferences")
    expect(KycRequestSchema.shape).toHaveProperty("documentCount")
  })

  it("strips credentials and legacy field names a careless handler passes through", () => {
    const parsed = KycRequestListResponseSchema.parse({
      success: true,
      requests: [{ ...request, kycDocuments: ["legacy-shape"], password: "$2b$10$leaked" }],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrevious: false },
    })

    expect(JSON.stringify(parsed)).not.toContain("leaked")
    expect(JSON.stringify(parsed)).not.toContain("legacy-shape")
    expect(parsed.requests[0].documentReferences).toEqual(["kycdoc_v1_abc"])
  })

  it("passes the redaction guard, so references never sit beside a credential", () => {
    const parsed = KycRequestListResponseSchema.parse({
      success: true,
      requests: [request],
      pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1, hasNext: false, hasPrevious: false },
    })

    expect(() => assertNoForbiddenFields(parsed)).not.toThrow()
  })
})

describe("schema hygiene", () => {
  it("keeps forbidden field names out of every declared response schema", () => {
    function walk(schema: z.ZodTypeAny, path: string, depth = 0): void {
      if (depth > 12) return

      const unwrapped =
        schema instanceof z.ZodOptional ||
        schema instanceof z.ZodNullable ||
        schema instanceof z.ZodDefault
          ? (schema._def as { innerType: z.ZodTypeAny }).innerType
          : schema

      if (unwrapped instanceof z.ZodObject) {
        for (const [key, child] of Object.entries(unwrapped.shape as Record<string, z.ZodTypeAny>)) {
          expect(() => assertNoForbiddenFields({ [key]: null })).not.toThrow()
          walk(child, `${path}.${key}`, depth + 1)
        }
        return
      }

      if (unwrapped instanceof z.ZodArray) {
        walk((unwrapped._def as { type: z.ZodTypeAny }).type, `${path}[]`, depth + 1)
      }
    }

    for (const contract of apiContracts) {
      walk(contract.response, contract.operationId)
    }
  })
})
