import LedgerAccount from "../../models/LedgerAccount"
import LedgerEntry from "../../models/LedgerEntry"
import User from "../../models/User"

export interface ReconciliationReport {
  isBalanced: boolean
  totalsByCurrency: Record<string, { totalDebits: number; totalCredits: number; imbalance: number }>
  accountBalances: Array<{
    accountId: string
    name: string
    category: string
    currency: string
    balance: number
  }>
}

export class LedgerProjectionService {
  /**
   * Recomputes the net balance for a single ledger account from its entries.
   */
  static async computeAccountBalance(accountId: any): Promise<number> {
    const account = await LedgerAccount.findById(accountId)
    if (!account) {
      throw new Error("Account not found.")
    }

    const entries = await LedgerEntry.find({ accountId })

    let debitTotal = 0
    let creditTotal = 0

    for (const entry of entries) {
      if (entry.direction === "debit") {
        debitTotal += entry.amount
      } else {
        creditTotal += entry.amount
      }
    }

    debitTotal = Number(debitTotal.toFixed(6))
    creditTotal = Number(creditTotal.toFixed(6))

    // Balance calculation based on accounting rules:
    // Assets & Expenses: Balance = Debits - Credits
    // Liabilities, Equity, Revenue: Balance = Credits - Debits
    if (account.accountType === "asset" || account.accountType === "expense") {
      return Number((debitTotal - creditTotal).toFixed(6))
    } else {
      return Number((creditTotal - debitTotal).toFixed(6))
    }
  }

  /**
   * Rebuilds and syncs cached balances for all users from their ledger accounts.
   */
  static async rebuildUserBalances(): Promise<{ updatedCount: number; errors: string[] }> {
    const userAccounts = await LedgerAccount.find({
      category: { $in: ["investor_wallet", "driver_balance"] },
      ownerId: { $ne: null },
    })

    let updatedCount = 0
    const errors: string[] = []

    for (const acct of userAccounts) {
      try {
        const balance = await this.computeAccountBalance(acct._id)
        await User.updateOne({ _id: acct.ownerId }, { $set: { availableBalance: balance } })
        updatedCount++
      } catch (err: any) {
        errors.push(`Failed to rebuild user ${acct.ownerId}: ${err.message}`)
      }
    }

    return { updatedCount, errors }
  }

  /**
   * System-wide audit: checks that sum of all debits equals sum of all credits per currency.
   */
  static async reconcileLedger(): Promise<ReconciliationReport> {
    const allEntries = await LedgerEntry.find({})

    const totalsByCurrency: Record<string, { totalDebits: number; totalCredits: number; imbalance: number }> = {}

    for (const entry of allEntries) {
      const curr = entry.currency || "NGN"
      if (!totalsByCurrency[curr]) {
        totalsByCurrency[curr] = { totalDebits: 0, totalCredits: 0, imbalance: 0 }
      }
      if (entry.direction === "debit") {
        totalsByCurrency[curr].totalDebits += entry.amount
      } else {
        totalsByCurrency[curr].totalCredits += entry.amount
      }
    }

    let isBalanced = true

    for (const [curr, totals] of Object.entries(totalsByCurrency)) {
      totals.totalDebits = Number(totals.totalDebits.toFixed(6))
      totals.totalCredits = Number(totals.totalCredits.toFixed(6))
      totals.imbalance = Number((totals.totalDebits - totals.totalCredits).toFixed(6))
      if (Math.abs(totals.imbalance) > 0.00001) {
        isBalanced = false
      }
    }

    const allAccounts = await LedgerAccount.find({})
    const accountBalances = []

    for (const acct of allAccounts) {
      const bal = await this.computeAccountBalance(acct._id)
      accountBalances.push({
        accountId: acct._id.toString(),
        name: acct.name,
        category: acct.category,
        currency: acct.currency,
        balance: bal,
      })
    }

    return {
      isBalanced,
      totalsByCurrency,
      accountBalances,
    }
  }
}
