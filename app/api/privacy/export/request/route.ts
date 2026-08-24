/**
 * POST /api/privacy/export/request
 *
 * Initiates a new privacy data-export request for the authenticated user.
 * The response includes a confirmation token that must be presented to
 * `POST /api/privacy/deletion/[id]/confirm` (same pattern for export
 * confirmation — see /api/privacy/export/[id]/confirm for the export
 * counterpart).
 *
 * Idempotency-Key: clients SHOULD send a stable token (e.g. UUID) so
 * retries do not produce duplicate requests.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import {
  finalizeAuthenticatedResponse,
  requireAuthenticatedUser,
} from "@/lib/api/route-guard"
import { createPrivacyRequest } from "@/lib/privacy/privacy.service"

const bodySchema = z.object({
  userNote: z.string().trim().max(1000).optional(),
})

export async function POST(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["driver", "investor", "admin"], {
      unauthorizedMessage: "Authentication required to request a data export.",
    })
    if ("response" in authContext) return authContext.response

    let parsed: { data: z.infer<typeof bodySchema> } | { response: NextResponse } | null = null
    try {
      const text = await request.text()
      if (text && text.trim().length > 0) {
        const json = JSON.parse(text)
        parsed = { data: bodySchema.parse(json) }
      } else {
        parsed = { data: {} }
      }
    } catch (error) {
      return NextResponse.json(
        { message: "Invalid request body.", details: error instanceof Error ? error.message : String(error) },
        { status: 400 },
      )
    }
    if (!parsed) parsed = { data: {} }
    if ("response" in parsed) return parsed.response

    const idempotencyKey = request.headers.get("Idempotency-Key") || undefined

    const privacyRequest = await createPrivacyRequest({
      userId: authContext.user._id.toString(),
      requestType: "EXPORT",
      userNote: parsed.data.userNote,
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
        message:
          "Export request created. Confirm within the token TTL to begin processing.",
      },
      { status: 201 },
    )
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("PRIVACY_EXPORT_REQUEST_ERROR", error)
    return NextResponse.json(
      {
        message: "Failed to create export request.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 500 },
    )
  }
}
