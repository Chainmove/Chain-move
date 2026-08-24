/**
 * GET /api/admin/privacy/audit
 *
 * Returns the audit log entries scoped to the privacy lifecycle so
 * administrators can review what happened to a user or to a request.
 */

import { NextResponse } from "next/server"

import { requireAuthenticatedUser } from "@/lib/api/route-guard"
import dbConnect from "@/lib/dbConnect"
import AuditLog from "@/models/AuditLog"

const PRIVACY_ACTIONS = [
  "privacy.request.created",
  "privacy.request.cancelled",
  "privacy.export.archive_created",
  "privacy.export.archive_downloaded",
  "privacy.export.archive_download_failed",
  "privacy.export.archive_expired",
  "privacy.export.processing_started",
  "privacy.export.completed",
  "privacy.export.failed",
  "privacy.deletion.confirmation_received",
  "privacy.deletion.processing_started",
  "privacy.deletion.step_failed",
  "privacy.deletion.completed",
  "privacy.deletion.blocked_by_hold",
  "privacy.hold.created",
  "privacy.hold.released",
  "privacy.hold.expired_bulk",
]

export async function GET(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in authContext) return authContext.response

    await dbConnect()
    const url = new URL(request.url)
    const userId = url.searchParams.get("userId")
    const limit = Math.min(Number.parseInt(url.searchParams.get("limit") || "100", 10), 500)

    const filter: any = { action: { $in: PRIVACY_ACTIONS } }
    if (userId) {
      filter.$or = [{ "metadata.userId": userId }, { actorId: userId }]
    }

    const events = await AuditLog.find(filter).sort({ createdAt: -1 }).limit(limit).lean()

    return NextResponse.json({
      events: events.map((e) => ({
        id: e._id?.toString(),
        actorId: e.actorId?.toString(),
        actorRole: e.actorRole,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        status: e.status,
        metadata: e.metadata || {},
        createdAt: e.createdAt?.toISOString() || null,
      })),
    })
  } catch (error) {
    console.error("ADMIN_PRIVACY_AUDIT_ERROR", error)
    return NextResponse.json({ message: "Failed to load privacy audit log." }, { status: 500 })
  }
}
