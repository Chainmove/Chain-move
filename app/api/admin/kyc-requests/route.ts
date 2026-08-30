import { KycRequestListQuerySchema, KycRequestListResponseSchema } from "@/lib/api/contracts"
import { buildPaginationMeta } from "@/lib/api/pagination"
import { defineRoute } from "@/lib/api/route-handler"
import { serializeDateTime, serializeId } from "@/lib/api/serialization"
import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"

export const GET = defineRoute({
  operationId: "listKycRequests",
  method: "GET",
  auth: "authenticated",
  action: "kyc:review",
  resource: () => ({ type: "kyc" }),
  query: KycRequestListQuerySchema,
  response: KycRequestListResponseSchema,
  successStatus: 200,
  handler: async ({ query }) => {
    await dbConnect()

    const filter: Record<string, unknown> = { role: { $in: ["driver", "investor"] } }
    if (query.status) filter.kycStatus = query.status

    const [users, total] = await Promise.all([
      User.find(filter)
        .select(
          "role name fullName email phoneNumber kycStatus kycDocuments kycRejectionReason " +
            "physicalMeetingDate physicalMeetingStatus updatedAt",
        )
        .sort({ updatedAt: -1 })
        .skip((query.page - 1) * query.pageSize)
        .limit(query.pageSize)
        .lean(),
      User.countDocuments(filter),
    ])

    return {
      success: true as const,
      requests: users.map((user) => ({
        id: serializeId(user._id) as string,
        role: user.role,
        name: user.fullName ?? user.name ?? null,
        email: user.email ?? null,
        phoneNumber: user.phoneNumber ?? null,
        kycStatus: user.kycStatus ?? "none",
        documentCount: Array.isArray(user.kycDocuments) ? user.kycDocuments.length : 0,
        // The reviewer needs these to open each document. Resolution still goes
        // through GET /api/kyc-documents, which authorizes per document.
        documentReferences: Array.isArray(user.kycDocuments) ? user.kycDocuments.map(String) : [],
        rejectionReason: user.kycRejectionReason ?? null,
        physicalMeetingStatus: user.physicalMeetingStatus ?? null,
        physicalMeetingDate: serializeDateTime(user.physicalMeetingDate),
        updatedAt: serializeDateTime(user.updatedAt),
      })),
      pagination: buildPaginationMeta({ page: query.page, pageSize: query.pageSize, total }),
    }
  },
})
