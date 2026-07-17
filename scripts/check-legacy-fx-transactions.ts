import dbConnect from "@/lib/dbConnect"
import Transaction from "@/models/Transaction"

async function main() {
  await dbConnect()

  const records = await Transaction.find({
    $or: [
      { exchangeRate: { $exists: true } },
      { originalCurrency: { $exists: true } },
      { amountOriginal: { $exists: true } },
    ],
  })
    .select("_id amount amountOriginal currency originalCurrency exchangeRate exchangeRateQuoteId")
    .lean()

  const valid: string[] = []
  const ambiguous: string[] = []

  for (const record of records) {
    const hasPositiveRate = Number.isFinite(record.exchangeRate) && Number(record.exchangeRate) > 0
    const hasOriginalCurrency = typeof record.originalCurrency === "string" && record.originalCurrency.length === 3
    const hasBookedQuote = Boolean(record.exchangeRateQuoteId)

    if (hasBookedQuote || (hasPositiveRate && hasOriginalCurrency)) {
      valid.push(record._id.toString())
    } else {
      ambiguous.push(record._id.toString())
    }
  }

  console.log(
    JSON.stringify(
      {
        checked: records.length,
        validLegacy: valid.length,
        ambiguousLegacy: ambiguous.length,
        ambiguous,
      },
      null,
      2,
    ),
  )
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
