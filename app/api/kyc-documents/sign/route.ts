import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseJsonBody } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import { createSignedDocumentUrl } from "@/lib/security/kyc-signed-urls"
import { isDocumentAccessible } from "@/lib/security/kyc-scanning"
import { logAuditEvent } from "@/lib/security/audit-log"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import KycDocument from "@/models/KycDocument"

const bodySchema = z.object({
  documentId: z.string().trim().min(1),
  ttlSeconds: z.number().int().min(60).max(900).optional(),
})

export async function POST(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin", "driver", "investor"])
    if ("response" in authContext) return authContext.response

    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("signed-url", authContext.user._id.toString(), getClientIpAddress(request)),
      limit: 30,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const body = await parseJsonBody(request, bodySchema)
    if ("response" in body) return body.response

    await dbConnect()

    const doc = await KycDocument.findById(body.data.documentId).lean()
    if (!doc) {
      return NextResponse.json({ message: "Document not found." }, { status: 404 })
    }

    if (!isDocumentAccessible(doc.status) && authContext.user.role !== "admin") {
      return NextResponse.json({ message: "Document is not accessible." }, { status: 403 })
    }

    if (authContext.user.role !== "admin" && doc.userId?.toString() !== authContext.user._id.toString()) {
      return NextResponse.json({ message: "Access denied." }, { status: 403 })
    }

    const { url, expiresAt } = createSignedDocumentUrl(
      body.data.documentId,
      authContext.user._id.toString(),
      body.data.ttlSeconds,
    )

    await logAuditEvent({
      actor: authContext.user,
      action: "kyc.document.signed_url.created",
      targetType: "kyc_document",
      targetId: body.data.documentId,
      metadata: { expiresAt, ttlSeconds: body.data.ttlSeconds },
    })

    const response = NextResponse.json({
      success: true,
      url,
      expiresAt,
    })

    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("KYC_SIGNED_URL_ERROR", error)
    return NextResponse.json({ message: "Failed to generate signed URL." }, { status: 500 })
  }
}
