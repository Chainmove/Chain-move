/**
 * POST /api/privacy/deletion/request
 *
 * Initiates a privacy deletion request for the authenticated user. The
 * request enters CONFIRMATION_PENDING and requires a confirmation token
 * before the cooling-off period begins.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import {
  finalizeAuthenticatedResponse,
  requireAuthenticatedUser,
} from "@/lib/api/route-guard"
import { createPrivacyRequest } from "@/lib/privacy/privacy.service"
import { listActiveHoldsForUser } from "@/lib/privacy/legal-hold.service"

const bodySchema = z.object({
  userNote: z.string().trim().max(1000).optional(),
})

export async function POST(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["driver", "investor", "admin"], {
      unauthorizedMessage: "Authentication required to request account deletion.",
    })
    if ("response" in authContext) return authContext.response

    let parsed: { data: z.infer<typeof bodySchema> } | null = null
    try {
      const text = await request.text()
      if (text && text.trim().length > 0) {
        const json = JSON.parse(text)
        parsed = { data: bodySchema.parse(json) }
      }
    } catch (error) {
      return NextResponse.json(
        {
          message: "Invalid request body.",
          details: error instanceof Error ? error.message : String(error),
        },
        { status: 400 },
      )
    }

    const userId = authContext.user._id.toString()
    const idempotencyKey = request.headers.get("Idempotency-Key") || undefined

    // Surface active holds up-front so the user understands blockers before
    // they confirm. Holds do NOT prevent request creation — only execution.
    const activeHolds = await listActiveHoldsForUser(userId)

    const privacyRequest = await createPrivacyRequest({
      userId,
      requestType: "DELETION",
      userNote: parsed?.data.userNote,
      idempotencyKey,
    })

    const response = NextResponse.json(
      {
        request: {
          id: privacyRequest.id,
          requestType: privacyRequest.requestType,
          status: privacyRequest.status,
          confirmationToken: privacyRequest.confirmationToken,
          confirmationTokenExpiresAt:
            privacyRequest.confirmationTokenExpiresAt?.toISOString() || null,
        },
        activeHolds: activeHolds.map((h) => ({
          id: h.id,
          reason: h.reason,
          reasonText: h.reasonText,
          resourceType: h.resourceType,
          resourceId: h.resourceId,
          expiresAt: h.expiresAt?.toISOString() || null,
        })),
        message:
          "Deletion request created. Confirm within the token TTL to start the cooling-off period.",
      },
      { status: 201 },
    )
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("PRIVACY_DELETION_REQUEST_ERROR", error)
    return NextResponse.json(
      {
        message: "Failed to create deletion request.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
