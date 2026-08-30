import {
  FleetDocumentCreateRequestSchema,
  FleetDocumentCreateResponseSchema,
  FleetDocumentListResponseSchema,
  FleetDocumentQuerySchema,
} from "@/lib/api/contracts"
import { buildPaginationMeta } from "@/lib/api/pagination"
import { defineRoute } from "@/lib/api/route-handler"
import { serializeDateTime, serializeId } from "@/lib/api/serialization"
import dbConnect from "@/lib/dbConnect"
import { evaluateVehicleCompliance } from "@/lib/fleet/complianceService"
import VehicleDocument from "@/models/VehicleDocument"

/**
 * Explicit projection. `fileUrl` is intentionally absent: it is a direct blob
 * link that bypasses per-document authorization, so it must not be listed.
 */
function serializeVehicleDocument(document: Record<string, any>) {
  return {
    id: serializeId(document._id) as string,
    vehicleId: serializeId(document.vehicleId) as string,
    documentType: document.documentType,
    title: document.title ?? "",
    documentNumber: document.documentNumber ?? null,
    issuingAuthority: document.issuingAuthority ?? null,
    issueDate: serializeDateTime(document.issueDate),
    expiryDate: serializeDateTime(document.expiryDate),
    verificationStatus: document.verificationStatus ?? "pending",
    rejectionReason: document.rejectionReason ?? null,
    notes: document.notes ?? null,
    createdAt: serializeDateTime(document.createdAt),
    updatedAt: serializeDateTime(document.updatedAt),
  }
}

export const GET = defineRoute({
  operationId: "listVehicleDocuments",
  method: "GET",
  auth: "authenticated",
  action: "vehicle:read",
  resource: () => ({ type: "vehicle" }),
  query: FleetDocumentQuerySchema,
  response: FleetDocumentListResponseSchema,
  successStatus: 200,
  handler: async ({ query }) => {
    await dbConnect()

    const filter: Record<string, unknown> = {}
    if (query.vehicleId) filter.vehicleId = query.vehicleId
    if (query.documentType) filter.documentType = query.documentType

    const [documents, total] = await Promise.all([
      VehicleDocument.find(filter)
        .sort({ expiryDate: 1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      VehicleDocument.countDocuments(filter),
    ])

    return {
      success: true as const,
      documents: documents.map(serializeVehicleDocument),
      pagination: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    }
  },
})

export const POST = defineRoute({
  operationId: "createVehicleDocument",
  method: "POST",
  auth: "authenticated",
  action: "vehicle:manage",
  resource: () => ({ type: "vehicle" }),
  body: FleetDocumentCreateRequestSchema,
  response: FleetDocumentCreateResponseSchema,
  successStatus: 201,
  handler: async ({ body }) => {
    await dbConnect()

    const created = await VehicleDocument.create({
      vehicleId: body.vehicleId,
      documentType: body.documentType,
      title: body.title,
      documentNumber: body.documentNumber,
      issuingAuthority: body.issuingAuthority,
      issueDate: new Date(body.issueDate),
      expiryDate: new Date(body.expiryDate),
      fileUrl: body.fileUrl,
      notes: body.notes,
      // Preserves existing behaviour. Auto-verifying a self-attested compliance
      // document is a control weakness, but changing it is a fleet-workflow
      // decision rather than an API-contract one.
      verificationStatus: "verified",
    })

    await evaluateVehicleCompliance(body.vehicleId)

    return {
      success: true as const,
      document: serializeVehicleDocument(created.toObject()),
    }
  },
})
