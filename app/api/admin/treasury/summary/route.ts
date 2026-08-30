import { NextResponse } from "next/server"
import { requireAuthenticatedUser, finalizeAuthenticatedResponse } from "@/lib/api/route-guard"
import { calculateTreasuryPosition, type TreasuryBucket } from "@/lib/treasury/service"
import dbConnect from "@/lib/dbConnect"
import LedgerAccount from "@/models/LedgerAccount"
import LedgerEntry from "@/models/LedgerEntry"
import TreasurySnapshot from "@/models/TreasurySnapshot"

const CATEGORY_BUCKET: Record<string, TreasuryBucket> = {
  platform_clearing: "available_cash", pool_escrow: "restricted_escrow", settlement_in_transit: "settlement_in_transit",
  payouts_payable: "investor_payable", refunds_payable: "refund_payable", platform_reserve: "platform_reserve",
  revenue_fees: "fees", suspense: "suspense",
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in auth) return auth.response
    await dbConnect()
    const currency = new URL(request.url).searchParams.get("currency") || "NGN"
    const accounts = await LedgerAccount.find({ currency, category: { $in: Object.keys(CATEGORY_BUCKET) } }).lean()
    const accountIds = accounts.map((account: any) => account._id)
    const totals = accountIds.length ? await LedgerEntry.aggregate([
      { $match: { accountId: { $in: accountIds }, currency } },
      { $group: { _id: { accountId: "$accountId", direction: "$direction" }, amount: { $sum: "$amount" } } },
    ]) : []
    const byAccount = new Map<string, number>()
    for (const total of totals) {
      const key = total._id.accountId.toString()
      byAccount.set(key, (byAccount.get(key) || 0) + (total._id.direction === "debit" ? total.amount : -total.amount))
    }
    const buckets: Partial<Record<TreasuryBucket, number>> = {}
    for (const account of accounts as any[]) {
      const bucket = CATEGORY_BUCKET[account.category]
      // Values must be integer minor units; legacy decimal entries are refused rather than rounded.
      const amount = Math.abs(byAccount.get(account._id.toString()) || 0)
      if (!Number.isSafeInteger(amount)) throw new Error("Treasury cannot summarize legacy non-minor-unit ledger entries.")
      buckets[bucket] = (buckets[bucket] || 0) + amount
    }
    const position = calculateTreasuryPosition(buckets, { minimumReserveMinor: 0 })
    const response = NextResponse.json({ success: true, currency, position, source: { ledgerEntryCount: totals.length, credentialsIncluded: false } })
    return finalizeAuthenticatedResponse(response, auth)
  } catch (error) {
    return NextResponse.json({ message: error instanceof Error ? error.message : "Failed to load treasury summary." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in auth) return auth.response
    const body = await request.json().catch(() => ({}))
    const currency = typeof body.currency === "string" ? body.currency : "NGN"
    const response = await GET(new Request(`${request.url}?currency=${encodeURIComponent(currency)}`, { headers: request.headers }))
    if (!response.ok) return response
    const payload = await response.json()
    const snapshotDate = new Date().toISOString().slice(0, 10)
    await TreasurySnapshot.findOneAndUpdate({ snapshotDate, currency }, { $set: { snapshotDate, currency, buckets: payload.position.buckets, availableLiquidityMinor: payload.position.availableLiquidityMinor, requiredLiquidityMinor: payload.position.requiredLiquidityMinor, varianceMinor: payload.position.varianceMinor, explanations: payload.position.explanations, sourceJournalCount: payload.source.ledgerEntryCount, sourceThrough: new Date() } }, { upsert: true, new: true })
    return NextResponse.json({ success: true, snapshotDate, position: payload.position })
  } catch (error) { return NextResponse.json({ message: error instanceof Error ? error.message : "Failed to create snapshot." }, { status: 500 }) }
}
