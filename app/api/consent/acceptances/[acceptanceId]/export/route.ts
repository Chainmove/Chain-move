import {
  ConsentAcceptanceParamsSchema,
  ConsentEvidenceExportResponseSchema,
} from "@/lib/api/contracts"
import { defineRoute } from "@/lib/api/route-handler"
import { exportConsentEvidence } from "@/lib/consent/financial-consent"

export const GET = defineRoute({
  operationId: "exportConsentEvidence",
  method: "GET",
  auth: "authenticated",
  params: ConsentAcceptanceParamsSchema,
  response: ConsentEvidenceExportResponseSchema,
  successStatus: 200,
  handler: async ({ user, params }) => {
    const evidence = await exportConsentEvidence({
      acceptanceId: params.acceptanceId,
      userId: String(user._id),
    })

    return { success: true as const, evidence }
  },
})
