import { NextResponse } from "next/server"
import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import dbConnect from "@/lib/dbConnect"
import { createStellarIndexer } from "@/lib/stellar/indexer"

export async function POST(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in auth) return auth.response

    await dbConnect()

    const indexer = createStellarIndexer()
    const result = await indexer.sync()

    const response = NextResponse.json({
      success: true,
      processed: result.processed,
      duplicates: result.duplicates,
      errors: result.errors,
      lastCursor: result.lastCursor,
    })

    return finalizeAuthenticatedResponse(response, auth)
  } catch (error) {
    console.error("STELLAR_SYNC_API_ERROR", error)
    return NextResponse.json({ error: "Failed to sync Stellar indexer" }, { status: 500 })
  }
}
