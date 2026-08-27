import {
  ConsentChallengeAcceptRequestSchema,
  ConsentChallengeAcceptResponseSchema,
  ConsentChallengeParamsSchema,
} from "@/lib/api/contracts"
import { defineRoute } from "@/lib/api/route-handler"
import { acceptConsentChallenge, hashEvidenceValue } from "@/lib/consent/financial-consent"

function hashedHeader(request: Request, name: string) {
  return hashEvidenceValue(request.headers.get(name))
}

export const POST = defineRoute({
  operationId: "acceptConsentChallenge",
  method: "POST",
  auth: "authenticated",
  params: ConsentChallengeParamsSchema,
  body: ConsentChallengeAcceptRequestSchema,
  response: ConsentChallengeAcceptResponseSchema,
  successStatus: 201,
  handler: async ({ user, params, body, request }) => {
    const acceptance = await acceptConsentChallenge({
      challengeId: params.challengeId,
      userId: String(user._id),
      role: (user.role as "driver" | "investor" | "admin") || "investor",
      intent: body.intent,
      sessionEvidence: {
        ...body.sessionEvidence,
        sessionIdHash: hashedHeader(request, "x-session-id"),
        userAgentHash: hashedHeader(request, "user-agent"),
        ipAddressHash: hashedHeader(request, "x-forwarded-for"),
      },
      walletEvidence: body.walletEvidence,
      renderManifest: body.renderManifest,
    })

    return {
      success: true as const,
      acceptance: {
        acceptanceId: acceptance.acceptanceId,
        challengeId: acceptance.challengeId,
        documentSetHash: acceptance.documentSetHash,
        consentHash: acceptance.consentHash,
        acceptedAt: acceptance.acceptedAt,
      },
    }
  },
})
