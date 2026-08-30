/**
 * GET  /api/admin/privacy/holds   — list holds (filterable by status).
 * POST /api/admin/privacy/holds   — create a new legal / operational hold.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import { requireAuthenticatedUser } from "@/lib/api/route-guard"
import {
  createLegalHold,
  listAllHolds,
  summarizeHoldsForAdmin,
} from "@/lib/privacy/legal-hold.service"

const createHoldSchema = z.object({
  userId: z.string().trim().min(1).optional(),
  resourceType: z
    .enum([
      "user",
      "kyc_document",
      "wallet",
      "contract",
      "investment",
      "transaction",
      "loan",
      "vehicle",
      "audit_record",
    ])
    .optional(),
  resourceId: z.string().trim().min(1).optional(),
  description: z.string().trim().max(500).optional(),
  reason: z.enum([
    "litigation",
    "regulatory_investigation",
    "tax_audit",
    "law_enforcement_request",
    "aml_review",
    "internal_fraud_investigation",
    "compliance_hold",
    "operational",
  ]),
  reasonText: z.string().trim().max(1000).optional(),
  expiresAt: z.string().datetime().optional(),
  reference: z.string().trim().max(200).optional(),
})

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in authContext) return authContext.response

    const url = new URL(request.url)
    const status = url.searchParams.get("status") as "ACTIVE" | "RELEASED" | "EXPIRED" | null
    const holds = await listAllHolds({
      status: status && ["ACTIVE", "RELEASED", "EXPIRED"].includes(status) ? status : "ACTIVE",
    })

    return NextResponse.json({ holds: summarizeHoldsForAdmin(holds) })
  } catch (error) {
    console.error("ADMIN_PRIVACY_HOLDS_LIST_ERROR", error)
    return NextResponse.json({ message: "Failed to list holds." }, { status: 500 })
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in authContext) return authContext.response

    let parsed: z.infer<typeof createHoldSchema>
    try {
      const json = await request.json()
      parsed = createHoldSchema.parse(json)
    } catch (error) {
      return NextResponse.json(
        {
          message: "Invalid hold creation body.",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      )
    }
    const data = parsed
    if (!data.userId && !(data.resourceType && data.resourceId)) {
      return NextResponse.json(
        { message: "Either userId or (resourceType, resourceId) is required." },
        { status: 400 },
      )
    }

    const hold = await createLegalHold({
      userId: data.userId,
      resourceType: data.resourceType,
      resourceId: data.resourceId,
      description: data.description,
      reason: data.reason,
      reasonText: data.reasonText,
      expiresAt: data.expiresAt ? new Date(data.expiresAt) : undefined,
      reference: data.reference,
      actor: { id: authContext.user._id.toString(), role: "admin" },
    })

    return NextResponse.json({ hold: summarizeHoldsForAdmin([hold])[0] }, { status: 201 })
  } catch (error) {
    console.error("ADMIN_PRIVACY_HOLDS_CREATE_ERROR", error)
    return NextResponse.json(
      {
        message: "Failed to create hold.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
