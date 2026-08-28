import mongoose from "mongoose"
import { get } from "@vercel/blob"
import { NextResponse } from "next/server"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import dbConnect from "@/lib/dbConnect"
import { isPrivateFleetDocumentBlobUrl } from "@/lib/security/fleet-documents"
import { logAuditEvent } from "@/lib/security/audit-log"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import FleetDocumentUpload from "@/models/FleetDocumentUpload"

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 140) || "document"
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { id } = params
    if (!mongoose.Types.ObjectId.isValid(id)) {
      return NextResponse.json({ message: "Document not found." }, { status: 404 })
    }

    const authContext = await requireAuthenticatedUser(request, ["admin"], {
      forbiddenMessage: "Admin access required",
    })
    if ("response" in authContext) return authContext.response

    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("fleet-document", authContext.user._id.toString(), getClientIpAddress(request)),
      limit: 60,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

    await dbConnect()

    const doc = await FleetDocumentUpload.findById(id).lean()
    if (!doc || doc.status === "deleted") {
      return NextResponse.json({ message: "Document not found." }, { status: 404 })
    }

    if (doc.retentionExpiresAt && doc.retentionExpiresAt.getTime() <= Date.now()) {
      return NextResponse.json({ message: "Document is no longer available." }, { status: 404 })
    }

    if (!isPrivateFleetDocumentBlobUrl(doc.blobUrl)) {
      return NextResponse.json({ message: "Unsupported fleet document reference." }, { status: 400 })
    }

    const privateBlob = await get(doc.blobUrl, { access: "private" })
    if (privateBlob?.statusCode !== 200 || !privateBlob.stream) {
      return NextResponse.json({ message: "Unable to load document." }, { status: 404 })
    }

    const body = Buffer.from(await new Response(privateBlob.stream).arrayBuffer())
    const filename = sanitizeFilename(doc.originalFilename)

    await FleetDocumentUpload.findByIdAndUpdate(doc._id, {
      $inc: { accessCount: 1 },
      lastAccessedAt: new Date(),
      lastAccessedBy: authContext.user._id,
    })

    await logAuditEvent({
      actor: authContext.user,
      action: "fleet.document.view",
      targetType: "fleet_document",
      targetId: doc._id.toString(),
      metadata: { filename, contentType: doc.contentType, vehicleId: doc.vehicleId?.toString() },
    })

    const response = new NextResponse(body as any, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Type": doc.contentType || "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    })

    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("FLEET_DOCUMENT_DOWNLOAD_ERROR", error)
    return NextResponse.json({ message: "Failed to load fleet document." }, { status: 500 })
  }
}
