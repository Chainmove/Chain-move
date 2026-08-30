import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseJsonBody, parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import { softDeleteDocument, setLegalHold, enforceRetentionPolicy } from "@/lib/security/kyc-retention"
import { logAuditEvent } from "@/lib/security/audit-log"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import KycDocument from "@/models/KycDocument"

const listQuerySchema = z.object({
  status: z.enum(["pending", "quarantined", "approved", "rejected", "deleted", "expired"]).optional(),
  userId: z.string().optional(),
  scanVerdict: z.enum(["clean", "suspicious", "malicious", "pending"]).optional(),
  legalHold: z.enum(["true", "false"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
})

const actionBodySchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("delete"),
    documentId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("set_legal_hold"),
    documentId: z.string().trim().min(1),
    hold: z.boolean(),
  }),
  z.object({
    action: z.literal("approve"),
    documentId: z.string().trim().min(1),
  }),
  z.object({
    action: z.literal("reject"),
    documentId: z.string().trim().min(1),
    reason: z.string().trim().max(500).optional(),
  }),
  z.object({
    action: z.literal("enforce_retention"),
  }),
  z.object({
    action: z.literal("quarantine_release"),
    documentId: z.string().trim().min(1),
    verdict: z.enum(["clean", "suspicious"]),
  }),
])

export async function GET(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in authContext) return authContext.response

    const query = parseSearchParams(request, listQuerySchema)
    if ("response" in query) return query.response

    await dbConnect()

    const filter: Record<string, unknown> = {}
    if (query.data.status) filter.status = query.data.status
    if (query.data.userId) filter.userId = query.data.userId
    if (query.data.scanVerdict) filter.scanVerdict = query.data.scanVerdict
    if (query.data.legalHold !== undefined) filter.legalHold = query.data.legalHold === "true"

    const skip = (query.data.page - 1) * query.data.limit
    const [documents, total] = await Promise.all([
      KycDocument.find(filter)
        .select("-scanDetails")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(query.data.limit)
        .lean(),
      KycDocument.countDocuments(filter),
    ])

    const sanitized = documents.map((doc) => ({
      _id: doc._id,
      userId: doc.userId,
      documentType: doc.documentType,
      status: doc.status,
      originalFilename: doc.originalFilename,
      contentType: doc.contentType,
      fileSize: doc.fileSize,
      checksumSha256: doc.checksumSha256,
      scanVerdict: doc.scanVerdict,
      legalHold: doc.legalHold,
      accessCount: doc.accessCount,
      lastAccessedAt: doc.lastAccessedAt,
      retentionExpiresAt: doc.retentionExpiresAt,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    }))

    const response = NextResponse.json({
      documents: sanitized,
      pagination: {
        page: query.data.page,
        limit: query.data.limit,
        total,
        pages: Math.ceil(total / query.data.limit),
      },
    })

    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("KYC_ADMIN_LIST_ERROR", error)
    return NextResponse.json({ message: "Failed to list documents." }, { status: 500 })
  }
}

export async function POST(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin"])
    if ("response" in authContext) return authContext.response

    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("kyc-admin-action", authContext.user._id.toString(), getClientIpAddress(request)),
      limit: 30,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const body = await parseJsonBody(request, actionBodySchema)
    if ("response" in body) return body.response

    await dbConnect()

    const data = body.data

    if (data.action === "delete") {
      const result = await softDeleteDocument(data.documentId, authContext.user._id?.toString(), "admin_deletion")
      return NextResponse.json(result, { status: result.success ? 200 : 400 })
    }

    if (data.action === "set_legal_hold") {
      const result = await setLegalHold(data.documentId, data.hold)
      return NextResponse.json(result, { status: result.success ? 200 : 400 })
    }

    if (data.action === "approve") {
      const doc = await KycDocument.findById(data.documentId)
      if (!doc) {
        return NextResponse.json({ message: "Document not found." }, { status: 404 })
      }

      if (doc.status !== "pending" && doc.status !== "quarantined") {
        return NextResponse.json({ message: "Document cannot be approved in its current state." }, { status: 400 })
      }

      await KycDocument.findByIdAndUpdate(data.documentId, {
        status: "approved",
        reviewedAt: new Date(),
        reviewedBy: authContext.user._id,
      })

      await logAuditEvent({
        actor: authContext.user,
        action: "kyc.document.review.approved",
        targetType: "kyc_document",
        targetId: data.documentId,
        metadata: { userId: doc.userId?.toString() },
      })

      return NextResponse.json({ success: true, message: "Document approved." })
    }

    if (data.action === "reject") {
      const doc = await KycDocument.findById(data.documentId)
      if (!doc) {
        return NextResponse.json({ message: "Document not found." }, { status: 404 })
      }

      if (doc.status !== "pending" && doc.status !== "quarantined") {
        return NextResponse.json({ message: "Document cannot be rejected in its current state." }, { status: 400 })
      }

      await KycDocument.findByIdAndUpdate(data.documentId, {
        status: "rejected",
        rejectionReason: data.reason || null,
        reviewedAt: new Date(),
        reviewedBy: authContext.user._id,
      })

      await logAuditEvent({
        actor: authContext.user,
        action: "kyc.document.review.rejected",
        targetType: "kyc_document",
        targetId: data.documentId,
        metadata: { userId: doc.userId?.toString(), reason: data.reason },
      })

      return NextResponse.json({ success: true, message: "Document rejected." })
    }

    if (data.action === "enforce_retention") {
      const result = await enforceRetentionPolicy()
      return NextResponse.json({ success: true, ...result })
    }

    if (data.action === "quarantine_release") {
      const doc = await KycDocument.findById(data.documentId)
      if (!doc) {
        return NextResponse.json({ message: "Document not found." }, { status: 404 })
      }

      if (doc.status !== "quarantined") {
        return NextResponse.json({ message: "Document is not quarantined." }, { status: 400 })
      }

      await KycDocument.findByIdAndUpdate(data.documentId, {
        status: data.verdict === "clean" ? "pending" : "rejected",
        scanVerdict: data.verdict,
      })

      await logAuditEvent({
        actor: authContext.user,
        action: "kyc.document.quarantine.release",
        targetType: "kyc_document",
        targetId: data.documentId,
        metadata: { newVerdict: data.verdict },
      })

      return NextResponse.json({ success: true, message: "Quarantine released." })
    }

    return NextResponse.json({ message: "Unknown action." }, { status: 400 })
  } catch (error) {
    console.error("KYC_ADMIN_ACTION_ERROR", error)
    return NextResponse.json({ message: "Failed to perform action." }, { status: 500 })
  }
}
