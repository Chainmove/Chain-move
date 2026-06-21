import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import {
  decryptKycDocument,
  isAllowedKycBlobUrl,
  parseKycDocumentReference,
} from "@/lib/security/kyc-documents"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import User from "@/models/User"

const querySchema = z.object({
  ref: z.string().trim().min(1).max(5000),
})

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 140) || "document"
}

export async function GET(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin", "driver", "investor"])
    if ("response" in authContext) return authContext.response

    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("kyc-document", authContext.user._id.toString(), getClientIpAddress(request)),
      limit: 60,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const query = parseSearchParams(request, querySchema)
    if ("response" in query) return query.response

    const reference = query.data.ref

    await dbConnect()

    const documentOwnerExists = await User.exists({
      kycDocuments: reference,
    })

    if (!documentOwnerExists) {
      return NextResponse.json({ message: "Document not found." }, { status: 404 })
    }

    if (authContext.user.role !== "admin") {
      const ownsDocument = Array.isArray(authContext.user.kycDocuments) && authContext.user.kycDocuments.includes(reference)
      if (!ownsDocument) {
        return NextResponse.json({ message: "You do not have access to this document." }, { status: 403 })
      }
    }

    const secureReference = parseKycDocumentReference(reference)
    const rawBlobUrl = secureReference?.url || reference

    if (!isAllowedKycBlobUrl(rawBlobUrl)) {
      return NextResponse.json({ message: "Unsupported KYC document reference." }, { status: 400 })
    }

    const upstreamResponse = await fetch(rawBlobUrl, { cache: "no-store" })
    if (!upstreamResponse.ok) {
      return NextResponse.json({ message: "Unable to load document." }, { status: 404 })
    }

    let body: Buffer
    let contentType = upstreamResponse.headers.get("content-type") || "application/octet-stream"
    let filename = sanitizeFilename(rawBlobUrl.split("/").pop() || "document")

    if (secureReference) {
      const encryptedPayload = Buffer.from(await upstreamResponse.arrayBuffer())
      const decryptedDocument = decryptKycDocument(encryptedPayload)
      body = decryptedDocument.buffer
      contentType = decryptedDocument.contentType
      filename = sanitizeFilename(decryptedDocument.originalFilename)
    } else {
      body = Buffer.from(await upstreamResponse.arrayBuffer())
    }

    const response = new NextResponse(body as any, {
      status: 200,
      headers: {
        "Cache-Control": "private, no-store, max-age=0",
        "Content-Disposition": `inline; filename="${filename}"`,
        "Content-Type": contentType,
        "X-Content-Type-Options": "nosniff",
      },
    })

    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("KYC_DOCUMENT_GET_ERROR", error)
    return NextResponse.json({ message: "Failed to load KYC document." }, { status: 500 })
  }
}
