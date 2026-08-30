import { NextResponse } from "next/server"
import { get } from "@vercel/blob"
import { z } from "zod"

import { finalizeAuthenticatedResponse } from "@/lib/api/route-guard"
import { authorizeRequest } from "@/lib/authorization/route"
import { parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import {
  decryptKycDocument,
  isAllowedKycBlobUrl,
  isPrivateKycBlobUrl,
  parseKycDocumentReference,
} from "@/lib/security/kyc-documents"
import { verifySignedDocumentUrl } from "@/lib/security/kyc-signed-urls"
import { isDocumentAccessible } from "@/lib/security/kyc-scanning"
import { logAuditEvent } from "@/lib/security/audit-log"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import KycDocument from "@/models/KycDocument"
import User from "@/models/User"

const querySchema = z.object({
  ref: z.string().trim().min(1).max(5000),
  token: z.string().optional(),
})

function sanitizeFilename(filename: string) {
  return filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 140) || "document"
}

export async function GET(request: Request) {
  try {
    const query = parseSearchParams(request, querySchema)
    if ("response" in query) return query.response

    const reference = query.data.ref

    await dbConnect()

    const documentOwner = await User.findOne({
      kycDocuments: reference,
    }).select("_id").lean()

    const authContext = await authorizeRequest(request, "kyc:document:read", {
      type: "kyc", ownerId: documentOwner?._id?.toString(), exists: Boolean(documentOwner),
    })
    if ("response" in authContext) return authContext.response

    if (query.data.token) {
      const verification = verifySignedDocumentUrl(query.data.token)
      if (!verification.valid) {
        return NextResponse.json({ message: verification.error || "Invalid signed URL." }, { status: 403 })
      }

      if (verification.payload!.documentId !== reference) {
        return NextResponse.json({ message: "Token does not match document." }, { status: 403 })
      }

      if (verification.payload!.userId !== authContext.user._id.toString() && authContext.user.role !== "admin") {
        return NextResponse.json({ message: "Access denied." }, { status: 403 })
      }
    } else {
      const documentOwnerExists = await KycDocument.exists({
        _id: reference,
        status: { $ne: "deleted" },
      })

      if (!documentOwnerExists) {
        const legacyExists = await User.exists({ kycDocuments: reference })
        if (!legacyExists) {
          return NextResponse.json({ message: "Document not found." }, { status: 404 })
        }
      } else {
        const doc = await KycDocument.findById(reference).select("userId status").lean()
        if (doc) {
          if (!isDocumentAccessible(doc.status) && authContext.user.role !== "admin") {
            return NextResponse.json({ message: "Document is not accessible." }, { status: 403 })
          }

          if (authContext.user.role !== "admin" && doc.userId?.toString() !== authContext.user._id.toString()) {
            return NextResponse.json({ message: "You do not have access to this document." }, { status: 403 })
          }
        }
      }
    }

    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("kyc-document", authContext.user._id.toString(), getClientIpAddress(request)),
      limit: 60,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) return rateLimitExceededResponse(rateLimit)

    let docRecord: any = null
    let rawBlobUrl: string
    let secureReference = parseKycDocumentReference(reference)

    if (secureReference) {
      rawBlobUrl = secureReference.url
    } else {
      docRecord = await KycDocument.findById(reference).lean()
      if (docRecord) {
        rawBlobUrl = docRecord.blobUrl
        secureReference = {
          version: 1,
          url: docRecord.blobUrl,
          originalFilename: docRecord.originalFilename,
          contentType: docRecord.contentType,
        }
      } else {
        return NextResponse.json({ message: "Document not found." }, { status: 404 })
      }
    }

    if (!isAllowedKycBlobUrl(rawBlobUrl)) {
      return NextResponse.json({ message: "Unsupported KYC document reference." }, { status: 400 })
    }

    let body: Buffer
    let encryptedPayload: Buffer
    let contentType = "application/octet-stream"
    let filename = sanitizeFilename(rawBlobUrl.split("/").pop() || "document")

    if (isPrivateKycBlobUrl(rawBlobUrl)) {
      const privateBlob = await get(rawBlobUrl, { access: "private" })
      if (privateBlob?.statusCode !== 200 || !privateBlob.stream) {
        return NextResponse.json({ message: "Unable to load document." }, { status: 404 })
      }
      encryptedPayload = Buffer.from(await new Response(privateBlob.stream).arrayBuffer())
      contentType = privateBlob.blob.contentType || contentType
    } else {
      // Compatibility window for inventoried legacy blobs only. New uploads are
      // always private and the migration script revokes these public objects.
      const legacyBlob = await fetch(rawBlobUrl, { cache: "no-store" })
      if (!legacyBlob.ok) {
        return NextResponse.json({ message: "Unable to load document." }, { status: 404 })
      }
      encryptedPayload = Buffer.from(await legacyBlob.arrayBuffer())
      contentType = legacyBlob.headers.get("content-type") || contentType
    }

    if (secureReference) {
      const decryptedDocument = decryptKycDocument(encryptedPayload)
      body = decryptedDocument.buffer
      contentType = decryptedDocument.contentType
      filename = sanitizeFilename(decryptedDocument.originalFilename)
    } else {
      body = encryptedPayload
    }

    if (docRecord) {
      await KycDocument.findByIdAndUpdate(docRecord._id, {
        $inc: { accessCount: 1 },
        lastAccessedAt: new Date(),
        lastAccessedBy: authContext.user._id,
      })

      await logAuditEvent({
        actor: authContext.user,
        action: "kyc.document.view",
        targetType: "kyc_document",
        targetId: docRecord._id.toString(),
        metadata: { filename, contentType },
      })
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
