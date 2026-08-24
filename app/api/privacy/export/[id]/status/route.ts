/**
 * GET /api/privacy/export/[id]/status
 *
 * Returns the status of a single privacy export request along with the
 * archive metadata (if the request has completed).
 */

import { NextResponse } from "next/server"

import {
  finalizeAuthenticatedResponse,
  requireAuthenticatedUser,
} from "@/lib/api/route-guard"
import {
  findActiveArchiveForRequest,
  findArchiveByIdForUser,
  findRequestByIdForUser,
} from "@/lib/privacy/data-export.service"
import { summarizeRequestForUser } from "@/lib/privacy/privacy.service"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params
    const authContext = await requireAuthenticatedUser(request, ["driver", "investor", "admin"])
    if ("response" in authContext) return authContext.response

    const userId = authContext.user._id.toString()
    const privacyRequest = await findRequestByIdForUser(id, userId)
    if (!privacyRequest) {
      return NextResponse.json({ message: "Privacy request not found." }, { status: 404 })
    }

    const archive = privacyRequest.archiveId
      ? await findArchiveByIdForUser(privacyRequest.archiveId, userId)
      : await findActiveArchiveForRequest(privacyRequest.id)

    const response = NextResponse.json({
      request: summarizeRequestForUser(privacyRequest),
      archive: archive
        ? {
            archiveId: archive.archiveId,
            status: archive.status,
            expiresAt: archive.expiresAt?.toISOString() || null,
            downloadedAt: archive.downloadedAt?.toISOString() || null,
            downloadCount: archive.downloadCount,
            sectionCount: archive.sectionCount,
            recordCount: archive.recordCount,
            byteSize: archive.byteSize,
          }
        : null,
    })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("PRIVACY_EXPORT_STATUS_ERROR", error)
    return NextResponse.json(
      { message: "Failed to load privacy export status." },
      { status: 500 },
    )
  }
}
