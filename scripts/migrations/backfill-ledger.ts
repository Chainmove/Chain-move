import dotenv from "dotenv"
import mongoose from "mongoose"
import Transaction from "../../models/Transaction"
import { LedgerPostingService } from "../../lib/ledger/posting.service"
import LedgerJournal from "../../models/LedgerJournal"

dotenv.config()

export async function runBackfillLedger(options: { dryRun?: boolean; resume?: boolean } = {}) {
  const { dryRun = false, resume = false } = options

  const dbUri = process.env.MONGODB_URI || "mongodb://localhost:27017/chainmove_test"
  if (mongoose.connection.readyState === 0) {
    await mongoose.connect(dbUri)
  }

  const query: any = { status: "Completed" }
  const legacyTransactions = await Transaction.find(query).sort({ timestamp: 1 })

  console.log(`Found ${legacyTransactions.length} legacy completed transactions to evaluate.`)

  let processedCount = 0
  let skippedCount = 0
  let errorCount = 0

  for (const tx of legacyTransactions) {
    const referenceKey = `legacy_tx_${tx._id}`

    if (resume || !dryRun) {
      const existing = await LedgerJournal.findOne({ referenceKey })
      if (existing) {
        skippedCount++
        continue
      }
    }

    if (dryRun) {
      console.log(`[DRY-RUN] Would process Tx ${tx._id} (${tx.type}): ${tx.amount} ${tx.currency || "NGN"}`)
      processedCount++
      continue
    }

    try {
      const currency = tx.currency || "NGN"
      const userType = tx.userType === "driver" ? "driver" : "investor"

      switch (tx.type) {
        case "deposit":
        case "wallet_funding":
          await LedgerPostingService.postWalletFunding({
            userId: tx.userId,
            userType,
            amount: tx.amount,
            currency,
            referenceKey,
            description: `Legacy backfill: ${tx.description || tx.type}`,
          })
          break

        case "withdrawal":
        case "wallet_debit":
          await LedgerPostingService.postWalletDebit({
            userId: tx.userId,
            userType,
            amount: tx.amount,
            currency,
            referenceKey,
            description: `Legacy backfill: ${tx.description || tx.type}`,
          })
          break

        case "pool_investment":
        case "investment":
          await LedgerPostingService.postPoolInvestment({
            investorId: tx.userId,
            poolId: tx.relatedId || "legacy_pool",
            amount: tx.amount,
            currency,
            referenceKey,
          })
          break

        case "down_payment":
          await LedgerPostingService.postDownPayment({
            driverId: tx.userId,
            poolId: tx.relatedId,
            amount: tx.amount,
            currency,
            referenceKey,
          })
          break

        case "repayment":
          await LedgerPostingService.postRepayment({
            driverId: tx.userId,
            amount: tx.amount,
            currency,
            referenceKey,
          })
          break

        default:
          // Default fallback posting via wallet funding/debit
          if (tx.amount > 0) {
            await LedgerPostingService.postWalletFunding({
              userId: tx.userId,
              userType,
              amount: tx.amount,
              currency,
              referenceKey,
              description: `Legacy backfill: ${tx.type}`,
            })
          }
          break
      }
      processedCount++
    } catch (err: any) {
      console.error(`Error backfilling Tx ${tx._id}: ${err.message}`)
      errorCount++
    }
  }

  console.log(`Backfill summary: ${processedCount} processed, ${skippedCount} skipped, ${errorCount} errors.`)
  return { processedCount, skippedCount, errorCount }
}

if (require.main === module) {
  const args = process.argv.slice(2)
  const dryRun = args.includes("--dry-run")
  const resume = args.includes("--resume")

  runBackfillLedger({ dryRun, resume })
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err)
      process.exit(1)
    })
}
