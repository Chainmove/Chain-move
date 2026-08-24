/**
 * POST /api/privacy/export/[id]/confirm
 *
 * Confirms a pending privacy export request using the token issued at
 * creation. The confirmation runs the export pipeline synchronously and
 * returns the archive metadata.
 */

import { NextResponse } from "next/server"
import { z } from "zod"

import {
  finalizeAuthenticatedResponse,
  requireAuthenticatedUser,
} from "@/lib/api/route-guard"
import dbConnect from "@/lib/dbConnect"
import { confirmPrivacyRequest } from "@/lib/privacy/privacy.service"
import {
  findActiveArchiveForRequest,
  findRequestByIdForUser,
} from "@/lib/privacy/data-export.service"

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
        { message: "Invalid confirmation body.", details: error instanceof Error ? error.message : String(error) },
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

    const archive = updated.archiveId
      ? await findActiveArchiveForRequest(updated.id)
      : null

    const response = NextResponse.json(
      {
        request: {
          id: updated.id,
          status: updated.status,
          archiveId: updated.archiveId || null,
        },
        archive: archive
          ? {
              archiveId: archive.archiveId,
              status: archive.status,
              expiresAt: archive.expiresAt?.toISOString() || null,
              sectionCount: archive.sectionCount,
              recordCount: archive.recordCount,
              byteSize: archive.byteSize,
            }
          : null,
      },
      { status: 200 },
    )
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("PRIVACY_EXPORT_CONFIRM_ERROR", error)
    return NextResponse.json(
      {
        message: "Failed to confirm export request.",
        details: error instanceof Error ? error.message : String(error),
      },
      { status: 400 },
    )
  }
}
