/**
 * GET /api/privacy/export/[id]/download
 *
 * Downloads the encrypted archive produced for a privacy export request.
 * Requires the user's session and the `downloadToken` query parameter (the
 * token is visible only to the user that owns the request — it's surfaced
 * alongside the archive metadata in `/status`).
 *
 * Cross-user isolation: the archive is looked up by `archiveId`, then its
 * `userId` is compared against the authenticated user. A mismatch yields
 * 404 to avoid disclosing the archive's existence.
 */

import { NextResponse } from "next/server"

import {
  finalizeAuthenticatedResponse,
  requireAuthenticatedUser,
} from "@/lib/api/route-guard"
import { consumeArchiveDownload, findArchiveByIdForUser } from "@/lib/privacy/data-export.service"
import { logAuditEvent } from "@/lib/security/audit-log"

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: archiveId } = await params
    const authContext = await requireAuthenticatedUser(request, ["driver", "investor", "admin"])
    if ("response" in authContext) return authContext.response

    const url = new URL(request.url)
    const token = url.searchParams.get("token")
    if (!token) {
      return NextResponse.json(
        { message: "Missing download token." },
        { status: 400 },
      )
    }

    const userId = authContext.user._id.toString()
    const archive = await findArchiveByIdForUser(archiveId, userId)
    if (!archive) {
      return NextResponse.json({ message: "Archive not found." }, { status: 404 })
    }

    const result = await consumeArchiveDownload({ archiveId, downloadToken: token })
    if ("error" in result) {
      // Audit failed download attempts so brute-force probing is observable.
      await logAuditEvent({
        actor: { _id: userId, role: authContext.user.role },
        action: "privacy.export.archive_download_failed",
        targetType: "PrivacyExportArchive",
        targetId: archiveId,
        status: "failure",
        metadata: { reason: result.error },
      })
      return NextResponse.json({ message: result.error }, { status: result.status })
    }

    const response = new NextResponse(new Uint8Array(result.buffer), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        "Content-Disposition": `attachment; filename="privacy-export-${archiveId}.json"`,
        "X-Archive-Sha256": archive.checksumSha256,
      },
    })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("PRIVACY_EXPORT_DOWNLOAD_ERROR", error)
    return NextResponse.json(
      { message: "Failed to download archive." },
      { status: 500 },
    )
  }
}
