/**
 * POST /api/privacy/deletion/[id]/cancel
 *
 * Cancels a privacy deletion request that has not yet entered PROCESSING.
 * Once processing has started the request cannot be cancelled — by design
 * the deletion is committed at that point.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import {
  finalizeAuthenticatedResponse,
  requireAuthenticatedUser,
} from "@/lib/api/route-guard"
import dbConnect from "@/lib/dbConnect"
import { findRequestByIdForUser } from "@/lib/privacy/data-export.service"
import { cancelPrivacyRequest, summarizeRequestForUser } from "@/lib/privacy/privacy.service"

const bodySchema = z.object({
  reason: z.string().trim().min(3).max(500),
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
          message: "Invalid cancellation body.",
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

    const updated = await cancelPrivacyRequest({
      requestId: id,
      reason: parsed.data.reason,
      actor: { id: authContext.user._id.toString(), role: "user" },
    })

    const response = NextResponse.json({
      request: summarizeRequestForUser(updated),
      message: "Deletion request cancelled.",
    })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("PRIVACY_DELETION_CANCEL_ERROR", error)
    return NextResponse.json(
      {
        message: "Failed to cancel deletion request.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
