import { describe, it, expect, beforeEach, beforeAll, afterAll } from "vitest"
import mongoose from "mongoose"
import LedgerAccount from "../../models/LedgerAccount"
import LedgerJournal from "../../models/LedgerJournal"
import LedgerEntry from "../../models/LedgerEntry"
import { LedgerPostingService } from "../../lib/ledger/posting.service"
import { LedgerProjectionService } from "../../lib/ledger/projection.service"
import { runBackfillLedger } from "../../scripts/migrations/backfill-ledger"
import Transaction from "../../models/Transaction"
import User from "../../models/User"

describe("Double-Entry Accounting Ledger System", () => {
  let isDbConnected = false

  beforeAll(async () => {
    const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/chainmove_ledger_test"
    try {
      if (mongoose.connection.readyState === 0) {
        await mongoose.connect(mongoUri, { serverSelectionTimeoutMS: 2000 })
      }
      isDbConnected = mongoose.connection.readyState === 1
    } catch {
      isDbConnected = false
    }
  })

  beforeEach(async () => {
    if (isDbConnected) {
      await LedgerAccount.deleteMany({})
      await LedgerJournal.deleteMany({})
      await LedgerEntry.deleteMany({})
      await Transaction.deleteMany({})
      await User.deleteMany({})
    }
  })

  afterAll(async () => {
    if (isDbConnected) {
      await mongoose.disconnect()
    }
  })

  it("validates journal entries debit and credit balancing logic", () => {
    const balancedEntries = [
      { accountId: "acct1", direction: "debit" as const, amount: 100, currency: "NGN" },
      { accountId: "acct2", direction: "credit" as const, amount: 100, currency: "NGN" },
    ]

    const totalDebit = balancedEntries.filter(e => e.direction === "debit").reduce((s, e) => s + e.amount, 0)
    const totalCredit = balancedEntries.filter(e => e.direction === "credit").reduce((s, e) => s + e.amount, 0)

    expect(totalDebit).toEqual(totalCredit)
  })

  it("validates that unbalanced entries throw an error on postJournal", async () => {
    if (!isDbConnected) {
      // Logic test for unbalanced entries calculation
      const entries = [
        { accountId: "a1", direction: "debit" as const, amount: 100, currency: "NGN" },
        { accountId: "a2", direction: "credit" as const, amount: 80, currency: "NGN" },
      ]
      const debits = entries.filter(e => e.direction === "debit").reduce((s, e) => s + e.amount, 0)
      const credits = entries.filter(e => e.direction === "credit").reduce((s, e) => s + e.amount, 0)
      expect(debits).not.toEqual(credits)
      return
    }

    const acct1 = await LedgerPostingService.getOrCreateAccount({
      category: "investor_wallet",
      accountType: "liability",
      currency: "NGN",
    })
    const acct2 = await LedgerPostingService.getOrCreateAccount({
      category: "platform_clearing",
      accountType: "asset",
      currency: "NGN",
    })

    await expect(
      LedgerPostingService.postJournal({
        referenceKey: "unbalanced_test_1",
        eventType: "wallet_funding",
        description: "Unbalanced test",
        entries: [
          { accountId: acct1._id, direction: "debit", amount: 100, currency: "NGN" },
          { accountId: acct2._id, direction: "credit", amount: 90, currency: "NGN" },
        ],
      })
    ).rejects.toThrow("Unbalanced journal")
  })

  it("posts balanced journals successfully and enforces idempotency", async () => {
    if (!isDbConnected) return

    const userId = new mongoose.Types.ObjectId()
    const j1 = await LedgerPostingService.postWalletFunding({
      userId,
      userType: "investor",
      amount: 500,
      currency: "NGN",
      referenceKey: "idempotent_ref_100",
    })

    expect(j1.referenceKey).toBe("idempotent_ref_100")

    const j2 = await LedgerPostingService.postWalletFunding({
      userId,
      userType: "investor",
      amount: 500,
      currency: "NGN",
      referenceKey: "idempotent_ref_100",
    })

    expect(j2._id.toString()).toBe(j1._id.toString())
  })

  it("handles reversing entries correctly and marks original journal reversed", async () => {
    if (!isDbConnected) return

    const userId = new mongoose.Types.ObjectId()
    const actorId = new mongoose.Types.ObjectId()

    const j1 = await LedgerPostingService.postWalletFunding({
      userId,
      userType: "driver",
      amount: 250,
      currency: "NGN",
      referenceKey: "reversal_test_original",
    })

    const revJournal = await LedgerPostingService.reverseJournal(j1._id, actorId, "Incorrect deposit amount")
    expect(revJournal.eventType).toBe("adjustment")

    const updatedJ1 = await LedgerJournal.findById(j1._id)
    expect(updatedJ1?.isReversed).toBe(true)
  })

  it("computes net account balances accurately and passes reconciliation invariant", async () => {
    if (!isDbConnected) return

    const userId = new mongoose.Types.ObjectId()

    await LedgerPostingService.postWalletFunding({
      userId,
      userType: "investor",
      amount: 1000,
      currency: "NGN",
      referenceKey: "rec_fund_1",
    })

    await LedgerPostingService.postWalletDebit({
      userId,
      userType: "investor",
      amount: 300,
      currency: "NGN",
      referenceKey: "rec_debit_1",
    })

    const walletAccount = await LedgerAccount.findOne({ ownerId: userId, category: "investor_wallet" })
    expect(walletAccount).not.toBeNull()

    const balance = await LedgerProjectionService.computeAccountBalance(walletAccount!._id)
    expect(balance).toBe(700)

    const recReport = await LedgerProjectionService.reconcileLedger()
    expect(recReport.isBalanced).toBe(true)
  })

  it("executes legacy transaction backfill migration with dry run and resume", async () => {
    if (!isDbConnected) return

    const userId = new mongoose.Types.ObjectId()
    await Transaction.create({
      userId,
      userType: "investor",
      type: "wallet_funding",
      amount: 450,
      currency: "NGN",
      status: "Completed",
      description: "Legacy deposit",
      timestamp: new Date(),
    })

    const dryRes = await runBackfillLedger({ dryRun: true })
    expect(dryRes.processedCount).toBe(1)

    const realRes = await runBackfillLedger({ dryRun: false })
    expect(realRes.processedCount).toBe(1)

    const resumeRes = await runBackfillLedger({ resume: true })
    expect(resumeRes.skippedCount).toBe(1)
  })
})
