/**
 * POST /api/privacy/deletion/[id]/confirm
 *
 * Confirms a pending deletion request. After confirmation, the request
 * enters COOLING_OFF. Once the cooling-off period elapses (default 24h), a
 * sweep job advances it into PROCESSING.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import {
  finalizeAuthenticatedResponse,
  requireAuthenticatedUser,
} from "@/lib/api/route-guard"
import { confirmPrivacyRequest, summarizeRequestForUser } from "@/lib/privacy/privacy.service"
import dbConnect from "@/lib/dbConnect"
import { findRequestByIdForUser } from "@/lib/privacy/data-export.service"

const bodySchema = z.object({
  confirmationToken: z.string().min(1).max(200),
})

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const authContext = await requireAuthenticatedUser(request, ["driver", "investor", "admin"])
    if ("response" in authContext) return authContext.response

    let parsed: { data: z.infer<typeof bodySchema> } | { response: NextResponse }
    try {
      const json = await request.json()
      parsed = { data: bodySchema.parse(json) }
    } catch (error) {
      return NextResponse.json(
        {
          message: "Invalid confirmation body.",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      )
    }
    if ("response" in parsed) return parsed.response

    await dbConnect()
    const existing = await findRequestByIdForUser(id, authContext.user._id.toString())
    if (!existing) {
      return NextResponse.json({ message: "Privacy request not found." }, { status: 404 })
    }

    const updated = await confirmPrivacyRequest({
      requestId: id,
      confirmationToken: parsed.data.confirmationToken,
      actor: { id: authContext.user._id.toString(), role: "user" },
    })

    const response = NextResponse.json({
      request: summarizeRequestForUser(updated),
      message: updated.status === "COOLING_OFF"
        ? `Cooling-off period started. Deletion will run after ${updated.coolingOffEndsAt?.toISOString()}.`
        : "Deletion confirmation received.",
    })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("PRIVACY_DELETION_CONFIRM_ERROR", error)
    return NextResponse.json(
      {
        message: "Failed to confirm deletion request.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    )
  }
}
