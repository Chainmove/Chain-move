import { put } from "@vercel/blob"
import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import {
  createKycDocumentReference,
  encryptKycDocument,
} from "@/lib/security/kyc-documents"
import { validateKycFile, KYC_ALLOWED_MIME_TYPES, KYC_MAX_FILE_SIZE } from "@/lib/security/kyc-file-validation"
import { runScanHook } from "@/lib/security/kyc-scanning"
import { computeRetentionExpiry } from "@/lib/security/kyc-retention"
import { logAuditEvent } from "@/lib/security/audit-log"
import {
  buildRateLimitKey,
  consumeRateLimit,
  getClientIpAddress,
  rateLimitExceededResponse,
} from "@/lib/security/rate-limit"
import KycDocument from "@/models/KycDocument"

const VEHICLE_ALLOWED_CONTENT_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

const querySchema = z.object({
  filename: z.string().trim().min(1).max(200),
  scope: z.enum(["kyc", "vehicle"]),
  documentType: z.enum(["identity", "proof_of_address", "bvn", "nin", "other"]).optional(),
})

function sanitizeFilename(filename: string) {
  const baseName = filename.split(/[\\/]/).pop() || ""
  const sanitized = baseName.replace(/[^a-zA-Z0-9._-]/g, "_").replace(/_+/g, "_")
  return sanitized.slice(0, 120)
}

export async function POST(request: Request) {
  const query = parseSearchParams(request, querySchema)
  if ("response" in query) return query.response

  const filename = sanitizeFilename(query.data.filename)
  const scope = query.data.scope
  const contentType = request.headers.get("content-type") || ""
  const contentLengthHeader = request.headers.get("content-length")
  const contentLength = contentLengthHeader ? Number.parseInt(contentLengthHeader, 10) : NaN

  if (!filename) {
    return NextResponse.json({ message: "No filename provided." }, { status: 400 })
  }

  try {
    const authContext = await requireAuthenticatedUser(
      request,
      scope === "vehicle" ? ["admin"] : ["driver", "investor", "admin"],
      {
        forbiddenMessage: scope === "vehicle" ? "Admin access required" : "Authenticated KYC access required",
      },
    )
    if ("response" in authContext) return authContext.response

    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("upload", scope, authContext.user._id.toString(), getClientIpAddress(request)),
      limit: scope === "vehicle" ? 40 : 20,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const allowedContentTypes = scope === "vehicle" ? VEHICLE_ALLOWED_CONTENT_TYPES : KYC_ALLOWED_MIME_TYPES
    if (!allowedContentTypes.has(contentType)) {
      return NextResponse.json({ message: "Unsupported file type." }, { status: 400 })
    }

    if (Number.isFinite(contentLength) && contentLength > KYC_MAX_FILE_SIZE) {
      return NextResponse.json({ message: "File is too large." }, { status: 413 })
    }

    const fileBuffer = Buffer.from(await request.arrayBuffer())
    if (fileBuffer.length === 0) {
      return NextResponse.json({ message: "No file body provided." }, { status: 400 })
    }

    if (fileBuffer.length > KYC_MAX_FILE_SIZE) {
      return NextResponse.json({ message: "File is too large." }, { status: 413 })
    }

    if (scope === "kyc") {
      const validation = validateKycFile(fileBuffer, contentType, filename)
      if (!validation.valid) {
        await logAuditEvent({
          actor: authContext.user,
          action: "kyc.document.upload.rejected",
          targetType: "user",
          targetId: authContext.user._id?.toString(),
          status: "failure",
          ipAddress: getClientIpAddress(request),
          metadata: { filename, errors: validation.errors },
        })
        return NextResponse.json(
          { message: "File validation failed.", errors: validation.errors },
          { status: 400 },
        )
      }

      await dbConnect()

      const encryptedPayload = encryptKycDocument(fileBuffer, {
        contentType,
        originalFilename: filename,
      })

      const storageKey = `kyc/${authContext.user._id.toString()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename}.json`
      const blob = await put(storageKey, encryptedPayload, {
        access: "private",
        addRandomSuffix: false,
        contentType: "application/json",
      })

      if (!blob.url.includes(".private.blob.vercel-storage.com/")) {
        throw new Error("KYC uploads require a private Blob store.")
      }

      const encryptedRef = createKycDocumentReference({
        url: blob.url,
        originalFilename: filename,
        contentType,
      })

      const retentionExpiry = computeRetentionExpiry(new Date())

      const documentType = query.data.documentType || "other"

      const kycDoc = await KycDocument.create({
        userId: authContext.user._id,
        documentType,
        status: "pending",
        storageKey,
        blobUrl: blob.url,
        encryptedRef,
        originalFilename: filename,
        sanitizedFilename: filename,
        contentType,
        fileSize: fileBuffer.length,
        checksumSha256: validation.checksumSha256,
        encryptionKeyVersion: "kyc-v1",
        scanVerdict: "pending",
        retentionExpiresAt: retentionExpiry,
        legalHold: false,
        accessCount: 0,
      })

      await runScanHook(kycDoc._id.toString(), fileBuffer, {
        filename,
        contentType,
        checksumSha256: validation.checksumSha256,
      })

      await logAuditEvent({
        actor: authContext.user,
        action: "kyc.document.upload",
        targetType: "kyc_document",
        targetId: kycDoc._id.toString(),
        metadata: {
          filename,
          documentType,
          contentType,
          fileSize: fileBuffer.length,
          checksumSha256: validation.checksumSha256,
        },
      })

      const response = NextResponse.json({
        success: true,
        documentId: kycDoc._id.toString(),
        documentRef: encryptedRef,
        status: kycDoc.status,
      })

      return finalizeAuthenticatedResponse(response, authContext)
    }

    const uniqueFilename = `vehicles/${authContext.user._id.toString()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${filename}`
    const blob = await put(uniqueFilename, fileBuffer, {
      access: "public",
      addRandomSuffix: false,
      contentType,
    })

    const response = NextResponse.json(blob)
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("UPLOAD_ROUTE_ERROR", error)
    return NextResponse.json({ message: "Failed to upload file" }, { status: 500 })
  }
}
