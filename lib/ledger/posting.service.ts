import mongoose, { ClientSession } from "mongoose"
import LedgerAccount, { ILedgerAccount } from "../../models/LedgerAccount"
import LedgerJournal, { ILedgerJournal } from "../../models/LedgerJournal"
import LedgerEntry from "../../models/LedgerEntry"

export interface EntryInput {
  accountId: any
  direction: "debit" | "credit"
  amount: number
  currency: string
}

export interface PostJournalParams {
  referenceKey: string
  eventType:
    | "wallet_funding"
    | "wallet_debit"
    | "pool_investment"
    | "down_payment"
    | "repayment"
    | "refund"
    | "payout"
    | "fee"
    | "adjustment"
  description: string
  entries: EntryInput[]
  actorId?: any
  reason?: string
  metadata?: Record<string, unknown>
  session?: ClientSession
}

export class LedgerPostingService {
  /**
   * Helper to get or create a ledger account.
   */
  static async getOrCreateAccount(params: {
    category: ILedgerAccount["category"]
    accountType: ILedgerAccount["accountType"]
    currency?: string
    ownerId?: any
    ownerType?: ILedgerAccount["ownerType"]
    entityId?: string
    name?: string
    session?: ClientSession
  }): Promise<ILedgerAccount> {
    const currency = params.currency || "NGN"
    const name = params.name || `${params.category.toUpperCase()} (${currency})`

    let query: any = { category: params.category, currency }
    if (params.ownerId) query.ownerId = params.ownerId
    if (params.entityId) query.entityId = params.entityId

    let account = await LedgerAccount.findOne(query).session(params.session || null)
    if (!account) {
      const docs = await LedgerAccount.create(
        [
          {
            accountType: params.accountType,
            category: params.category,
            ownerId: params.ownerId,
            ownerType: params.ownerType,
            entityId: params.entityId,
            currency,
            name,
            isArchived: false,
          },
        ],
        params.session ? { session: params.session } : {}
      )
      account = docs[0]
    }
    return account
  }

  /**
   * Core posting function enforcing balanced debits and credits and idempotency.
   */
  static async postJournal(params: PostJournalParams): Promise<ILedgerJournal> {
    const { referenceKey, eventType, description, entries, actorId, reason, metadata, session } = params

    // Idempotency check: if referenceKey already exists, return existing journal
    const existing = await LedgerJournal.findOne({ referenceKey }).session(session || null)
    if (existing) {
      return existing
    }

    if (eventType === "adjustment" && (!actorId || !reason)) {
      throw new Error("Administrative adjustments require an actorId and a reason.")
    }

    if (!entries || entries.length < 2) {
      throw new Error("A journal must contain at least two entries (balanced debits and credits).")
    }

    // Validate debit and credit balance per currency
    const totalsByCurrency: Record<string, { debit: number; credit: number }> = {}

    for (const entry of entries) {
      if (entry.amount <= 0) {
        throw new Error("Entry amount must be greater than 0.")
      }
      const curr = entry.currency || "NGN"
      if (!totalsByCurrency[curr]) {
        totalsByCurrency[curr] = { debit: 0, credit: 0 }
      }
      if (entry.direction === "debit") {
        totalsByCurrency[curr].debit = Number((totalsByCurrency[curr].debit + entry.amount).toFixed(6))
      } else {
        totalsByCurrency[curr].credit = Number((totalsByCurrency[curr].credit + entry.amount).toFixed(6))
      }
    }

    for (const [curr, totals] of Object.entries(totalsByCurrency)) {
      if (Math.abs(totals.debit - totals.credit) > 0.00001) {
        throw new Error(
          `Unbalanced journal for currency ${curr}: total debits (${totals.debit}) do not equal total credits (${totals.credit}).`
        )
      }
    }

    const journalDocs = await LedgerJournal.create(
      [
        {
          referenceKey,
          eventType,
          description,
          status: "POSTED",
          isReversed: false,
          actorId,
          reason,
          metadata,
          postedAt: new Date(),
        },
      ],
      session ? { session } : {}
    )

    const journal = journalDocs[0]

    const entryDocs = entries.map((e) => ({
      journalId: journal._id,
      accountId: e.accountId,
      direction: e.direction,
      amount: e.amount,
      currency: e.currency || "NGN",
      timestamp: journal.postedAt,
    }))

    await LedgerEntry.create(entryDocs, session ? { session } : {})

    return journal
  }

  /**
   * Reverse an existing posted journal cleanly using balanced reversing entries.
   */
  static async reverseJournal(
    journalId: any,
    actorId: any,
    reason: string,
    session?: ClientSession
  ): Promise<ILedgerJournal> {
    const originalJournal = await LedgerJournal.findById(journalId).session(session || null)
    if (!originalJournal) {
      throw new Error("Journal not found.")
    }
    if (originalJournal.isReversed) {
      throw new Error("Journal is already reversed.")
    }

    const originalEntries = await LedgerEntry.find({ journalId }).session(session || null)
    const reversalEntries: EntryInput[] = originalEntries.map((e) => ({
      accountId: e.accountId,
      direction: e.direction === "debit" ? "credit" : "debit",
      amount: e.amount,
      currency: e.currency,
    }))

    const reversalRefKey = `reversal_${originalJournal.referenceKey}_${Date.now()}`

    const reversalJournal = await this.postJournal({
      referenceKey: reversalRefKey,
      eventType: "adjustment",
      description: `Reversal of journal ${originalJournal.referenceKey}: ${reason}`,
      entries: reversalEntries,
      actorId,
      reason,
      metadata: { reversalOf: originalJournal._id },
      session,
    })

    // Mark original journal as reversed directly via collection bypass to maintain audit trail flag
    await mongoose.connection.collection("ledgerjournals").updateOne(
      { _id: originalJournal._id },
      {
        $set: {
          isReversed: true,
          status: "REVERSED",
          reversedByJournalId: reversalJournal._id,
        },
      },
      session ? { session } : {}
    )

    return reversalJournal
  }

  // --- Domain Helpers ---

  static async postWalletFunding(params: {
    userId: any
    userType: "driver" | "investor"
    amount: number
    currency?: string
    referenceKey: string
    description?: string
    session?: ClientSession
  }) {
    const currency = params.currency || "NGN"
    const category = params.userType === "investor" ? "investor_wallet" : "driver_balance"

    const walletAccount = await this.getOrCreateAccount({
      category,
      accountType: "liability",
      currency,
      ownerId: params.userId,
      ownerType: params.userType,
      session: params.session,
    })

    const clearingAccount = await this.getOrCreateAccount({
      category: "platform_clearing",
      accountType: "asset",
      currency,
      session: params.session,
    })

    return this.postJournal({
      referenceKey: params.referenceKey,
      eventType: "wallet_funding",
      description: params.description || `Wallet funding for ${params.userType} ${params.userId}`,
      entries: [
        { accountId: clearingAccount._id, direction: "debit", amount: params.amount, currency },
        { accountId: walletAccount._id, direction: "credit", amount: params.amount, currency },
      ],
      session: params.session,
    })
  }

  static async postWalletDebit(params: {
    userId: any
    userType: "driver" | "investor"
    amount: number
    currency?: string
    referenceKey: string
    description?: string
    session?: ClientSession
  }) {
    const currency = params.currency || "NGN"
    const category = params.userType === "investor" ? "investor_wallet" : "driver_balance"

    const walletAccount = await this.getOrCreateAccount({
      category,
      accountType: "liability",
      currency,
      ownerId: params.userId,
      ownerType: params.userType,
      session: params.session,
    })

    const clearingAccount = await this.getOrCreateAccount({
      category: "platform_clearing",
      accountType: "asset",
      currency,
      session: params.session,
    })

    return this.postJournal({
      referenceKey: params.referenceKey,
      eventType: "wallet_debit",
      description: params.description || `Wallet debit for ${params.userType} ${params.userId}`,
      entries: [
        { accountId: walletAccount._id, direction: "debit", amount: params.amount, currency },
        { accountId: clearingAccount._id, direction: "credit", amount: params.amount, currency },
      ],
      session: params.session,
    })
  }

  static async postPoolInvestment(params: {
    investorId: any
    poolId: string
    amount: number
    currency?: string
    referenceKey: string
    session?: ClientSession
  }) {
    const currency = params.currency || "NGN"

    const investorWallet = await this.getOrCreateAccount({
      category: "investor_wallet",
      accountType: "liability",
      currency,
      ownerId: params.investorId,
      ownerType: "investor",
      session: params.session,
    })

    const poolEscrow = await this.getOrCreateAccount({
      category: "pool_escrow",
      accountType: "liability",
      entityId: params.poolId,
      currency,
      session: params.session,
    })

    return this.postJournal({
      referenceKey: params.referenceKey,
      eventType: "pool_investment",
      description: `Pool investment into ${params.poolId}`,
      entries: [
        { accountId: investorWallet._id, direction: "debit", amount: params.amount, currency },
        { accountId: poolEscrow._id, direction: "credit", amount: params.amount, currency },
      ],
      session: params.session,
    })
  }

  static async postDownPayment(params: {
    driverId: any
    poolId?: string
    amount: number
    currency?: string
    referenceKey: string
    session?: ClientSession
  }) {
    const currency = params.currency || "NGN"

    const driverWallet = await this.getOrCreateAccount({
      category: "driver_balance",
      accountType: "liability",
      currency,
      ownerId: params.driverId,
      ownerType: "driver",
      session: params.session,
    })

    const repaymentsReceivable = await this.getOrCreateAccount({
      category: "repayments_receivable",
      accountType: "asset",
      entityId: params.poolId,
      currency,
      session: params.session,
    })

    return this.postJournal({
      referenceKey: params.referenceKey,
      eventType: "down_payment",
      description: `Down payment by driver ${params.driverId}`,
      entries: [
        { accountId: driverWallet._id, direction: "debit", amount: params.amount, currency },
        { accountId: repaymentsReceivable._id, direction: "credit", amount: params.amount, currency },
      ],
      session: params.session,
    })
  }

  static async postRepayment(params: {
    driverId: any
    amount: number
    feeAmount?: number
    currency?: string
    referenceKey: string
    session?: ClientSession
  }) {
    const currency = params.currency || "NGN"
    const fee = params.feeAmount || 0
    const principal = params.amount - fee

    const driverWallet = await this.getOrCreateAccount({
      category: "driver_balance",
      accountType: "liability",
      currency,
      ownerId: params.driverId,
      ownerType: "driver",
      session: params.session,
    })

    const repaymentsReceivable = await this.getOrCreateAccount({
      category: "repayments_receivable",
      accountType: "asset",
      currency,
      session: params.session,
    })

    const entries: EntryInput[] = [
      { accountId: driverWallet._id, direction: "debit", amount: params.amount, currency },
      { accountId: repaymentsReceivable._id, direction: "credit", amount: principal, currency },
    ]

    if (fee > 0) {
      const revenueAccount = await this.getOrCreateAccount({
        category: "revenue_fees",
        accountType: "revenue",
        currency,
        session: params.session,
      })
      entries.push({ accountId: revenueAccount._id, direction: "credit", amount: fee, currency })
    }

    return this.postJournal({
      referenceKey: params.referenceKey,
      eventType: "repayment",
      description: `Repayment from driver ${params.driverId}`,
      entries,
      session: params.session,
    })
  }

  static async postRefund(params: {
    investorId: any
    poolId: string
    amount: number
    currency?: string
    referenceKey: string
    session?: ClientSession
  }) {
    const currency = params.currency || "NGN"

    const poolEscrow = await this.getOrCreateAccount({
      category: "pool_escrow",
      accountType: "liability",
      entityId: params.poolId,
      currency,
      session: params.session,
    })

    const investorWallet = await this.getOrCreateAccount({
      category: "investor_wallet",
      accountType: "liability",
      currency,
      ownerId: params.investorId,
      ownerType: "investor",
      session: params.session,
    })

    return this.postJournal({
      referenceKey: params.referenceKey,
      eventType: "refund",
      description: `Refund from pool ${params.poolId} to investor ${params.investorId}`,
      entries: [
        { accountId: poolEscrow._id, direction: "debit", amount: params.amount, currency },
        { accountId: investorWallet._id, direction: "credit", amount: params.amount, currency },
      ],
      session: params.session,
    })
  }

  static async postPayout(params: {
    userId: any
    userType: "driver" | "investor"
    amount: number
    currency?: string
    referenceKey: string
    session?: ClientSession
  }) {
    const currency = params.currency || "NGN"

    const payoutsPayable = await this.getOrCreateAccount({
      category: "payouts_payable",
      accountType: "liability",
      currency,
      session: params.session,
    })

    const clearingAccount = await this.getOrCreateAccount({
      category: "platform_clearing",
      accountType: "asset",
      currency,
      session: params.session,
    })

    return this.postJournal({
      referenceKey: params.referenceKey,
      eventType: "payout",
      description: `Payout processing for ${params.userType} ${params.userId}`,
      entries: [
        { accountId: payoutsPayable._id, direction: "debit", amount: params.amount, currency },
        { accountId: clearingAccount._id, direction: "credit", amount: params.amount, currency },
      ],
      session: params.session,
    })
  }

  static async postFee(params: {
    userId: any
    userType: "driver" | "investor"
    amount: number
    currency?: string
    referenceKey: string
    description?: string
    session?: ClientSession
  }) {
    const currency = params.currency || "NGN"
    const category = params.userType === "investor" ? "investor_wallet" : "driver_balance"

    const walletAccount = await this.getOrCreateAccount({
      category,
      accountType: "liability",
      currency,
      ownerId: params.userId,
      ownerType: params.userType,
      session: params.session,
    })

    const revenueFees = await this.getOrCreateAccount({
      category: "revenue_fees",
      accountType: "revenue",
      currency,
      session: params.session,
    })

    return this.postJournal({
      referenceKey: params.referenceKey,
      eventType: "fee",
      description: params.description || `Platform fee charged to ${params.userType} ${params.userId}`,
      entries: [
        { accountId: walletAccount._id, direction: "debit", amount: params.amount, currency },
        { accountId: revenueFees._id, direction: "credit", amount: params.amount, currency },
      ],
      session: params.session,
    })
  }

  static async postAdjustment(params: {
    targetAccountId: any
    direction: "debit" | "credit"
    amount: number
    currency?: string
    actorId: any
    reason: string
    referenceKey: string
    session?: ClientSession
  }) {
    const currency = params.currency || "NGN"

    const adjustmentAccount = await this.getOrCreateAccount({
      category: "adjustment",
      accountType: "equity",
      currency,
      session: params.session,
    })

    const oppositeDirection = params.direction === "debit" ? "credit" : "debit"

    return this.postJournal({
      referenceKey: params.referenceKey,
      eventType: "adjustment",
      description: `Administrative adjustment: ${params.reason}`,
      actorId: params.actorId,
      reason: params.reason,
      entries: [
        { accountId: params.targetAccountId, direction: params.direction, amount: params.amount, currency },
        { accountId: adjustmentAccount._id, direction: oppositeDirection, amount: params.amount, currency },
      ],
      session: params.session,
    })
  }
}
