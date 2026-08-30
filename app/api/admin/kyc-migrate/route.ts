import { NextResponse } from "next/server"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { migrateKycDocumentReferences } from "@/lib/security/kyc-migration"

export async function POST(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in authContext) return authContext.response

    const result = await migrateKycDocumentReferences()

    const response = NextResponse.json({
      success: true,
      ...result,
    })

    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("KYC_MIGRATION_ERROR", error)
    return NextResponse.json({ message: "Migration failed." }, { status: 500 })
  }
}
