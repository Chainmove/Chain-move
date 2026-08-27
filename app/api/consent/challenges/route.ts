import {
  ConsentChallengeCreateRequestSchema,
  ConsentChallengeCreateResponseSchema,
} from "@/lib/api/contracts"
import { defineRoute } from "@/lib/api/route-handler"
import {
  createConsentChallenge,
  REQUIRED_HIRE_PURCHASE_DOCUMENTS,
  REQUIRED_INVESTMENT_DOCUMENTS,
} from "@/lib/consent/financial-consent"

function requiredDocumentsForIntent(intentType: "pool_investment" | "hire_purchase_contract") {
  return intentType === "hire_purchase_contract" ? REQUIRED_HIRE_PURCHASE_DOCUMENTS : REQUIRED_INVESTMENT_DOCUMENTS
}

export const POST = defineRoute({
  operationId: "createConsentChallenge",
  method: "POST",
  auth: "authenticated",
  body: ConsentChallengeCreateRequestSchema,
  response: ConsentChallengeCreateResponseSchema,
  successStatus: 201,
  handler: async ({ user, body }) => {
    const challenge = await createConsentChallenge({
      userId: String(user._id),
      role: (user.role as "driver" | "investor" | "admin") || "investor",
      locale: body.locale,
      jurisdiction: body.jurisdiction,
      requiredDocuments: requiredDocumentsForIntent(body.intent.type),
      intent: body.intent,
    })

    return { success: true as const, challenge }
  },
})
