import { describe, it, expect, beforeAll, afterAll, afterEach, vi } from "vitest"
import mongoose from "mongoose"
import ReconciliationRun from "@/models/ReconciliationRun"
import ReconciliationDiscrepancy from "@/models/ReconciliationDiscrepancy"
import Transaction from "@/models/Transaction"
import DriverVirtualAccount from "@/models/DriverVirtualAccount"
import InvestorVirtualAccount from "@/models/InvestorVirtualAccount"
import DriverPayment from "@/models/DriverPayment"
import User from "@/models/User"
import AuditLog from "@/models/AuditLog"
import { MockPaystackAdapter } from "@/lib/paystack/mockAdapter"
import { PaystackAdapter } from "@/lib/paystack/paystackAdapter"
import { PaystackTransactionRecord, NormalizedPaystackTransaction } from "@/lib/paystack/types"
import {
  createDiscrepancyFingerprint,
  remediateDiscrepancy,
  runReconciliation,
  runReconciliationWithNormalizedData,
} from "@/lib/reconciliation/reconciliationEngine"
import {
  redactPii,
  generateReconciliationJsonSummary,
  generateReconciliationRunCsvExport,
} from "@/lib/reconciliation/reporting"
import axios from "axios"

vi.mock("axios")

describe("Paystack Settlement Reconciliation Subsystem Tests (#99)", () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      try {
        await mongoose.connect(
          process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove-test",
          { serverSelectionTimeoutMS: 2000 },
        )
      } catch (err) {
        console.warn("MongoDB connection warning in test environment:", err)
      }
    }
  }, 10000)

  afterAll(async () => {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.connection.close()
    }
  })

  afterEach(async () => {
    vi.clearAllMocks()
    if (mongoose.connection.readyState !== 0) {
      await ReconciliationRun.deleteMany({})
      await ReconciliationDiscrepancy.deleteMany({})
      await Transaction.deleteMany({})
      await DriverVirtualAccount.deleteMany({})
      await InvestorVirtualAccount.deleteMany({})
      await DriverPayment.deleteMany({})
      await User.deleteMany({})
      await AuditLog.deleteMany({})
    }
  })

  describe("Fingerprint and PII utilities", () => {
    it("should compute deterministic SHA-256 fingerprints for discrepancy deduplication", () => {
      const fp1 = createDiscrepancyFingerprint("MISSING_INTERNAL_RECORD", "REF-001", "", 50000)
      const fp2 = createDiscrepancyFingerprint("MISSING_INTERNAL_RECORD", "REF-001", "", 50000)
      const fp3 = createDiscrepancyFingerprint("AMOUNT_MISMATCH", "REF-001", "", 50000)

      expect(fp1).toBe(fp2)
      expect(fp1).not.toBe(fp3)
      expect(fp1.length).toBe(64)
    })

    it("should sanitize PII strings, objects, and email/phone patterns in reporting", () => {
      const input = {
        email: "payer@example.com",
        notes: "Contact customer at john.doe@domain.com or +2348012345678",
        nested: {
          phone: "+2348000000000",
          amount: 25000,
        },
      }

      const sanitized = redactPii(input)
      expect(sanitized.email).toBe("[REDACTED]")
      expect(sanitized.nested.phone).toBe("[REDACTED]")
      expect(sanitized.nested.amount).toBe(25000)
      expect(sanitized.notes).toContain("[REDACTED_EMAIL]")
      expect(sanitized.notes).toContain("[REDACTED_PHONE]")
    })
  })

  describe("PaystackAdapter", () => {
    it("should handle transient HTTP 429/5xx provider errors with retries in PaystackAdapter", async () => {
      const mockedAxios = axios as unknown as { get: ReturnType<typeof vi.fn> }
      mockedAxios.get
        .mockRejectedValueOnce({ response: { status: 429, data: { message: "Rate limit exceeded" } } })
        .mockResolvedValueOnce({
          data: {
            status: true,
            message: "Success",
            data: [],
            meta: { total: 0, skipped: 0, perPage: 50, page: 1, pageCount: 1 },
          },
        })

      const adapter = new PaystackAdapter("sk_test_123", 2)
      const result = await adapter.fetchTransactions({ page: 1, perPage: 50 })

      expect(result.status).toBe(true)
      expect(mockedAxios.get).toHaveBeenCalledTimes(2)
    })

    it("should validate normalized transactions and return accepted/rejected counts", async () => {
      const adapter = new PaystackAdapter("sk_test_123")
      const result = await adapter.acceptNormalizedTransactions({
        transactions: [
          { reference: "REF-001", amount: 50000, currency: "NGN", status: "success", createdAt: new Date().toISOString() },
          { reference: "REF-002", amount: 0, currency: "NGN", status: "success", createdAt: new Date().toISOString() },
          { reference: "", amount: 10000, currency: "NGN", status: "success", createdAt: new Date().toISOString() },
        ],
      })

      expect(result.accepted).toBe(1)
      expect(result.rejected).toBe(2)
      expect(result.errors.length).toBe(2)
    })
  })

  describe("MockPaystackAdapter", () => {
    it("should accept normalized transactions into its internal store", async () => {
      const adapter = new MockPaystackAdapter()
      const result = await adapter.acceptNormalizedTransactions({
        transactions: [
          { reference: "NORM-001", amount: 25000, currency: "NGN", status: "success", createdAt: new Date().toISOString() },
        ],
      })

      expect(result.accepted).toBe(1)
      expect(result.rejected).toBe(0)
      expect(adapter.getNormalizedStore().length).toBe(1)
    })
  })

  describe("runReconciliation with operator metadata", () => {
    it("should store operator metadata when provided", async () => {
      if (mongoose.connection.readyState !== 1) return

      const mockRecord: PaystackTransactionRecord = {
        id: 101,
        domain: "test",
        status: "success",
        reference: "OPERATOR-REF-001",
        amount: 5000000,
        gateway_response: "Successful",
        created_at: new Date().toISOString(),
        channel: "card",
        currency: "NGN",
      }

      const adapter = new MockPaystackAdapter([mockRecord])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
        triggeredBy: "admin_user",
        operator: {
          userId: "user-123",
          userAgent: "Mozilla/5.0",
          ipAddress: "192.168.1.1",
        },
      })

      expect(res.run.status).toBe("completed")
      expect(res.run.operator?.userId).toBe("user-123")
      expect(res.run.operator?.userAgent).toBe("Mozilla/5.0")
      expect(res.run.operator?.ipAddress).toBe("192.168.1.1")
    })

    it("should compute totals correctly in reconciliation run", async () => {
      if (mongoose.connection.readyState !== 1) return

      const dummyUser = await User.create({
        fullName: "Test Driver",
        email: "driver totals@example.com",
        role: "driver",
      })

      await Transaction.create({
        userId: dummyUser._id,
        userType: "driver",
        type: "wallet_funding",
        amount: 50000,
        currency: "NGN",
        gatewayReference: "TOTAL-REF-001",
        status: "Completed",
        timestamp: new Date(),
      })

      const mockRecord: PaystackTransactionRecord = {
        id: 201,
        domain: "test",
        status: "success",
        reference: "TOTAL-REF-001",
        amount: 5000000,
        gateway_response: "Successful",
        created_at: new Date().toISOString(),
        channel: "card",
        currency: "NGN",
      }

      const adapter = new MockPaystackAdapter([mockRecord])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
      })

      expect(res.run.totals.providerTotal).toBe(50000)
      expect(res.run.totals.internalTotal).toBe(50000)
      expect(res.run.totals.matchedCount).toBe(1)
      expect(res.run.totals.unmatchedCount).toBe(0)
      expect(res.run.totals.discrepancyTotal).toBe(0)
    })
  })

  describe("runReconciliationWithNormalizedData", () => {
    it("should accept normalized transactions and run reconciliation", async () => {
      if (mongoose.connection.readyState !== 1) return

      const dummyUser = await User.create({
        fullName: "Normalized User",
        email: "norm@example.com",
        role: "driver",
      })

      await Transaction.create({
        userId: dummyUser._id,
        userType: "driver",
        type: "wallet_funding",
        amount: 30000,
        currency: "NGN",
        gatewayReference: "NORM-REF-001",
        status: "Completed",
        timestamp: new Date(),
      })

      const normalizedTxs: NormalizedPaystackTransaction[] = [
        {
          reference: "NORM-REF-001",
          amount: 30000,
          currency: "NGN",
          status: "success",
          customerEmail: "norm@example.com",
          createdAt: new Date().toISOString(),
        },
      ]

      const adapter = new MockPaystackAdapter([])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res = await runReconciliationWithNormalizedData(
        start,
        end,
        adapter,
        normalizedTxs,
        "csv_import",
        { userId: "admin-1", ipAddress: "10.0.0.1" },
      )

      expect(res.run.status).toBe("completed")
      expect(res.run.triggeredBy).toBe("csv_import")
      expect(res.run.operator?.ipAddress).toBe("10.0.0.1")
    })

    it("should reject normalized transactions with invalid data", async () => {
      if (mongoose.connection.readyState !== 1) return

      const adapter = new MockPaystackAdapter([])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const normalizedTxs: NormalizedPaystackTransaction[] = [
        { reference: "", amount: 10000, currency: "NGN", status: "success", createdAt: new Date().toISOString() },
        { reference: "BAD-REF", amount: -500, currency: "NGN", status: "success", createdAt: new Date().toISOString() },
      ]

      const res = await runReconciliationWithNormalizedData(
        start,
        end,
        adapter,
        normalizedTxs,
      )

      expect(res.run.status).toBe("failed")
      expect(res.run.errorMessage).toContain("rejected")
    })
  })

  describe("Discrepancy detection", () => {
    it("should detect MISSING_INTERNAL_RECORD when Paystack has record but internal DB does not", async () => {
      if (mongoose.connection.readyState !== 1) return

      const mockRecord: PaystackTransactionRecord = {
        id: 101,
        domain: "test",
        status: "success",
        reference: "PAYSTACK-REF-101",
        amount: 5000000,
        gateway_response: "Successful",
        created_at: new Date().toISOString(),
        channel: "card",
        currency: "NGN",
        customer: { id: 1, email: "driver1@example.com", customer_code: "CUS_1" },
      }

      const adapter = new MockPaystackAdapter([mockRecord])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
      })
      expect(res.run.status).toBe("completed")
      expect(res.discrepancies.length).toBe(1)
      expect(res.discrepancies[0].category).toBe("MISSING_INTERNAL_RECORD")
      expect(res.discrepancies[0].providerReference).toBe("PAYSTACK-REF-101")
      expect(res.discrepancies[0].providerAmount).toBe(50000)
    })

    it("should detect MISSING_PROVIDER_RECORD when internal transaction has ref but Paystack returns nothing", async () => {
      if (mongoose.connection.readyState !== 1) return

      const dummyUser = await User.create({
        fullName: "Test Driver",
        email: "driver2@example.com",
        role: "driver",
      })

      await Transaction.create({
        userId: dummyUser._id,
        userType: "driver",
        type: "wallet_funding",
        amount: 35000,
        currency: "NGN",
        gatewayReference: "MISSING-PROVIDER-REF-999",
        status: "Completed",
        timestamp: new Date(),
      })

      const adapter = new MockPaystackAdapter([])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
      })

      const missingDisc = res.discrepancies.find((d) => d.category === "MISSING_PROVIDER_RECORD")
      expect(missingDisc).toBeDefined()
      expect(missingDisc?.providerReference).toBe("MISSING-PROVIDER-REF-999")
    })

    it("should detect AMOUNT_MISMATCH, STATUS_MISMATCH, and REVERSAL_REFUND", async () => {
      if (mongoose.connection.readyState !== 1) return

      const dummyUser = await User.create({
        fullName: "Test Investor",
        email: "investor@example.com",
        role: "investor",
      })

      await Transaction.create({
        userId: dummyUser._id,
        userType: "investor",
        type: "investment",
        amount: 100000,
        gatewayReference: "REF-AMOUNT-MISMATCH",
        status: "Completed",
        timestamp: new Date(),
      })

      await Transaction.create({
        userId: dummyUser._id,
        userType: "investor",
        type: "investment",
        amount: 50000,
        gatewayReference: "REF-STATUS-REVERSED",
        status: "Completed",
        timestamp: new Date(),
      })

      const mockRecords: PaystackTransactionRecord[] = [
        {
          id: 201,
          domain: "test",
          status: "success",
          reference: "REF-AMOUNT-MISMATCH",
          amount: 8000000,
          gateway_response: "Successful",
          created_at: new Date().toISOString(),
          channel: "card",
          currency: "NGN",
        },
        {
          id: 202,
          domain: "test",
          status: "reversed",
          reference: "REF-STATUS-REVERSED",
          amount: 5000000,
          gateway_response: "Reversed",
          created_at: new Date().toISOString(),
          channel: "card",
          currency: "NGN",
        },
      ]

      const adapter = new MockPaystackAdapter(mockRecords)
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
      })

      const amtMismatch = res.discrepancies.find((d) => d.category === "AMOUNT_MISMATCH")
      const reversalDisc = res.discrepancies.find((d) => d.category === "REVERSAL_REFUND")

      expect(amtMismatch).toBeDefined()
      expect(amtMismatch?.internalAmount).toBe(100000)
      expect(amtMismatch?.providerAmount).toBe(80000)

      expect(reversalDisc).toBeDefined()
      expect(reversalDisc?.providerStatus).toBe("reversed")
    })

    it("should detect INTERNAL_LEDGER_MISMATCH when internal amount differs from Paystack", async () => {
      if (mongoose.connection.readyState !== 1) return

      const dummyUser = await User.create({
        fullName: "Ledger Mismatch User",
        email: "ledger@example.com",
        role: "driver",
      })

      await Transaction.create({
        userId: dummyUser._id,
        userType: "driver",
        type: "wallet_funding",
        amount: 75000,
        currency: "NGN",
        gatewayReference: "LEDGER-MISMATCH-REF",
        status: "Completed",
        timestamp: new Date(),
      })

      const mockRecord: PaystackTransactionRecord = {
        id: 301,
        domain: "test",
        status: "success",
        reference: "LEDGER-MISMATCH-REF",
        amount: 5000000,
        gateway_response: "Successful",
        created_at: new Date().toISOString(),
        channel: "card",
        currency: "NGN",
      }

      const adapter = new MockPaystackAdapter([mockRecord])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
      })

      const ledgerMismatch = res.discrepancies.find((d) => d.category === "INTERNAL_LEDGER_MISMATCH")
      expect(ledgerMismatch).toBeDefined()
      expect(ledgerMismatch?.internalAmount).toBe(75000)
      expect(ledgerMismatch?.providerAmount).toBe(50000)
    })

    it("should detect DUPLICATE_INTERNAL_RECORD when internal has duplicate gateway references", async () => {
      if (mongoose.connection.readyState !== 1) return

      const dummyUser = await User.create({
        fullName: "Duplicate User",
        email: "dup@example.com",
        role: "driver",
      })

      await Transaction.create({
        userId: dummyUser._id,
        userType: "driver",
        type: "wallet_funding",
        amount: 20000,
        currency: "NGN",
        gatewayReference: "DUP-REF-001",
        status: "Completed",
        timestamp: new Date(),
      })

      await Transaction.create({
        userId: dummyUser._id,
        userType: "driver",
        type: "wallet_funding",
        amount: 20000,
        currency: "NGN",
        gatewayReference: "DUP-REF-001",
        status: "Completed",
        timestamp: new Date(),
      })

      const mockRecord: PaystackTransactionRecord = {
        id: 401,
        domain: "test",
        status: "success",
        reference: "DUP-REF-001",
        amount: 4000000,
        gateway_response: "Successful",
        created_at: new Date().toISOString(),
        channel: "card",
        currency: "NGN",
      }

      const adapter = new MockPaystackAdapter([mockRecord])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
      })

      const dupDisc = res.discrepancies.find((d) => d.category === "DUPLICATE_INTERNAL_RECORD")
      expect(dupDisc).toBeDefined()
    })
  })

  describe("DVA reconciliation", () => {
    it("should detect UNKNOWN_ACCOUNT for unregistered dedicated virtual account", async () => {
      if (mongoose.connection.readyState !== 1) return

      const mockRecord: PaystackTransactionRecord = {
        id: 501,
        domain: "test",
        status: "success",
        reference: "DVA-REF-001",
        amount: 1000000,
        gateway_response: "Successful",
        created_at: new Date().toISOString(),
        channel: "bank_transfer",
        currency: "NGN",
        customer: { id: 1, email: "dva@example.com", customer_code: "CUS_1" },
        dedicated_account: {
          account_number: "9999999999",
          account_name: "Unknown DVA",
          bank_name: "Unknown Bank",
        },
      }

      const adapter = new MockPaystackAdapter([mockRecord])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
      })

      const unknownDisc = res.discrepancies.find((d) => d.category === "UNKNOWN_ACCOUNT")
      expect(unknownDisc).toBeDefined()
      expect(unknownDisc?.providerDedicatedAccount).toBe("9999999999")
    })

    it("should match DVA transactions to registered driver virtual accounts", async () => {
      if (mongoose.connection.readyState !== 1) return

      const dummyUser = await User.create({
        fullName: "DVA Driver",
        email: "dvadriver@example.com",
        role: "driver",
      })

      await DriverVirtualAccount.create({
        driverUserId: dummyUser._id,
        contractId: "contract-123" as any,
        provider: "PAYSTACK",
        status: "ACTIVE",
        accountNumber: "1234567890",
        accountName: "DVA Driver",
        bankName: "Test Bank",
      })

      await Transaction.create({
        userId: dummyUser._id,
        userType: "driver",
        type: "wallet_funding",
        amount: 25000,
        currency: "NGN",
        gatewayReference: "DVA-MATCH-REF",
        status: "Completed",
        timestamp: new Date(),
      })

      const mockRecord: PaystackTransactionRecord = {
        id: 601,
        domain: "test",
        status: "success",
        reference: "DVA-MATCH-REF",
        amount: 2500000,
        gateway_response: "Successful",
        created_at: new Date().toISOString(),
        channel: "bank_transfer",
        currency: "NGN",
        dedicated_account: {
          account_number: "1234567890",
          account_name: "DVA Driver",
          bank_name: "Test Bank",
        },
      }

      const adapter = new MockPaystackAdapter([mockRecord])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
      })

      expect(res.discrepancies.filter((d) => d.category === "UNKNOWN_ACCOUNT").length).toBe(0)
      expect(res.run.totals.matchedCount).toBe(1)
    })
  })

  describe("Idempotency and remediation", () => {
    it("should enforce idempotency on repeated reconciliation runs", async () => {
      if (mongoose.connection.readyState !== 1) return

      const mockRecord: PaystackTransactionRecord = {
        id: 301,
        domain: "test",
        status: "success",
        reference: "IDEMPOTENT-REF-777",
        amount: 2500000,
        gateway_response: "Successful",
        created_at: new Date().toISOString(),
        channel: "card",
        currency: "NGN",
      }

      const adapter = new MockPaystackAdapter([mockRecord])
      const start = new Date(Date.now() - 3600000)
      const end = new Date(Date.now() + 3600000)

      const res1 = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
      })
      const res2 = await runReconciliation({
        periodStart: start,
        periodEnd: end,
        adapter,
      })

      expect(res1.discrepancies.length).toBe(1)
      expect(res2.discrepancies.length).toBe(1)

      const totalDiscDocs = await ReconciliationDiscrepancy.countDocuments({})
      expect(totalDiscDocs).toBe(1)
    })

    it("should execute authorized remediation and log audit entries", async () => {
      if (mongoose.connection.readyState !== 1) return

      const reviewer = await User.create({
        fullName: "Admin Reviewer",
        email: "admin@chainmove.com",
        role: "admin",
      })

      const disc = await ReconciliationDiscrepancy.create({
        fingerprint: "TEST-FP-REMEDIATION-1",
        runId: "RECON-TEST-1",
        category: "MISSING_INTERNAL_RECORD",
        providerReference: "REF-REMEDIATE-999",
        providerAmount: 75000,
        providerCurrency: "NGN",
        providerStatus: "success",
        explanation: "Missing internal record for Paystack reference REF-REMEDIATE-999",
        remediationStatus: "unresolved",
      })

      const remediated = await remediateDiscrepancy(
        disc._id.toString(),
        "RECONCILE_CREATE_TRANSACTION",
        reviewer._id.toString(),
        "Approved after verifying bank statement",
      )

      expect(remediated.remediationStatus).toBe("manually_resolved")
      expect(remediated.internalTransactionId).toBeDefined()
      expect(remediated.auditLogId).toBeDefined()

      const createdTx = await Transaction.findById(remediated.internalTransactionId)
      expect(createdTx).toBeDefined()
      expect(createdTx?.amount).toBe(75000)
      expect(createdTx?.gatewayReference).toBe("REF-REMEDIATE-999")

      const audit = await AuditLog.findById(remediated.auditLogId)
      expect(audit).toBeDefined()
      expect(audit?.action).toBe("RECONCILIATION_REMEDIATE")
    })
  })

  describe("Reporting", () => {
    it("should generate reconciliation JSON summary with totals and operator", async () => {
      if (mongoose.connection.readyState !== 1) return

      const run = await ReconciliationRun.create({
        runId: "RECON-SUMMARY-001",
        provider: "paystack",
        periodStart: new Date(Date.now() - 86400000),
        periodEnd: new Date(),
        status: "completed",
        triggeredBy: "admin_api",
        operator: {
          userId: "admin-user-1" as any,
          userAgent: "Mozilla/5.0",
          ipAddress: "10.0.0.1",
        },
        totals: {
          providerTotal: 100000,
          internalTotal: 95000,
          discrepancyTotal: 5000,
          remediatedTotal: 0,
          matchedCount: 1,
          unmatchedCount: 1,
        },
        metrics: {
          totalProviderRecords: 2,
          totalInternalRecords: 1,
          matchedRecords: 1,
          discrepancyCount: 1,
          remediatedCount: 0,
        },
      })

      const disc = await ReconciliationDiscrepancy.create({
        fingerprint: "FP-SUMMARY-001",
        runId: "RECON-SUMMARY-001",
        category: "MISSING_INTERNAL_RECORD",
        providerReference: "REF-SUMMARY-001",
        providerAmount: 5000,
        providerCurrency: "NGN",
        providerStatus: "success",
        explanation: "Test discrepancy for summary",
        remediationStatus: "unresolved",
      })

      const summary = generateReconciliationJsonSummary(run, [disc])

      expect(summary.runId).toBe("RECON-SUMMARY-001")
      expect(summary.provider).toBe("paystack")
      expect(summary.totals.providerTotal).toBe(100000)
      expect(summary.totals.internalTotal).toBe(95000)
      expect(summary.totals.discrepancyTotal).toBe(5000)
      expect(summary.operator?.userId).toBe("admin-user-1")
      expect(summary.operator?.ipAddress).toBe("10.0.0.1")
      expect(summary.totalDiscrepancies).toBe(1)
      expect(summary.byCategory["MISSING_INTERNAL_RECORD"]).toBe(1)
    })

    it("should generate reconciliation run CSV export", async () => {
      if (mongoose.connection.readyState !== 1) return

      await ReconciliationRun.create({
        runId: "RECON-CSV-001",
        provider: "paystack",
        periodStart: new Date(Date.now() - 86400000),
        periodEnd: new Date(),
        status: "completed",
        triggeredBy: "system",
        totals: {
          providerTotal: 50000,
          internalTotal: 50000,
          discrepancyTotal: 0,
          remediatedTotal: 0,
          matchedCount: 1,
          unmatchedCount: 0,
        },
        metrics: {
          totalProviderRecords: 1,
          totalInternalRecords: 1,
          matchedRecords: 1,
          discrepancyCount: 0,
          remediatedCount: 0,
        },
      })

      const runs = await ReconciliationRun.find({}).lean()
      const csv = generateReconciliationRunCsvExport(runs as any)

      expect(csv).toContain("RunID")
      expect(csv).toContain("RECON-CSV-001")
      expect(csv).toContain("paystack")
      expect(csv).toContain("ProviderTotal")
      expect(csv).toContain("OperatorUserId")
    })
  })
})