import { PaymentInitializeRequestSchema, PaymentInitializeResponseSchema } from "@/lib/api/contracts"
import { ApiError } from "@/lib/api/errors"
import { defineRoute } from "@/lib/api/route-handler"
import { money } from "@/lib/api/serialization"
import { generateReferenceId } from "@/lib/ids/reference-id"
import {
  buildRateLimitKey,
  consumeRateLimit,
  getClientIpAddress,
} from "@/lib/security/rate-limit"

function resolveCallbackUrl(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
  return `${appUrl}/dashboard/investor`
}

export const POST = defineRoute({
  operationId: "initializePayment",
  method: "POST",
  auth: "authenticated",
  body: PaymentInitializeRequestSchema,
  response: PaymentInitializeResponseSchema,
  successStatus: 201,
  handler: async ({ request, user, body, setHeader }) => {
    const secretKey = process.env.PAYSTACK_SECRET_KEY
    if (!secretKey) {
      throw new ApiError("NOT_CONFIGURED", { message: "Payment funding is not available right now." })
    }

    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("payments:initialize", String(user._id), getClientIpAddress(request)),
      limit: 10,
      windowMs: 10 * 60 * 1000,
    })

    if (!rateLimit.allowed) {
      throw new ApiError("RATE_LIMITED", {
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": String(rateLimit.resetAt),
        },
      })
    }

    setHeader("X-RateLimit-Remaining", String(rateLimit.remaining))
    setHeader("X-RateLimit-Reset", String(rateLimit.resetAt))

    const fundingEmail = (
      (user.email as string) ||
      body.email ||
      ""
    )
      .trim()
      .toLowerCase()

    if (!fundingEmail) {
      throw ApiError.validation(
        [{ path: "email", message: "An email is required to fund your wallet." }],
        "An email is required for Paystack funding.",
      )
    }

    const reference = generateReferenceId({ prefix: "cm_wallet" })

    let payload: {
      status?: boolean
      data?: { authorization_url?: string; access_code?: string; reference?: string }
    }
    let upstreamOk: boolean

    try {
      const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secretKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          amount: Math.round(body.amountNgn * 100),
          email: fundingEmail,
          reference,
          callback_url: resolveCallbackUrl(request),
          metadata: {
            paymentType: "wallet_funding",
            userId: String(user._id),
            role: user.role,
            amountNgn: body.amountNgn,
            payerEmail: fundingEmail,
          },
        }),
      })

      upstreamOk = paystackResponse.ok
      payload = await paystackResponse.json()
    } catch (error) {
      // Network-level failure: the provider never answered.
      throw new ApiError("UPSTREAM_UNAVAILABLE", {
        message: "We could not reach the payment provider. Please try again shortly.",
        cause: error,
      })
    }

    if (!upstreamOk || payload?.status === false || !payload?.data?.authorization_url) {
      // The provider's message is logged but not returned: it can echo request
      // details and provider-internal state.
      throw new ApiError("UPSTREAM_PROVIDER_ERROR", {
        message: "The payment provider could not start this transaction. Please try again.",
        logContext: { reference, providerStatus: payload?.status },
        cause: payload,
      })
    }

    return {
      success: true as const,
      payment: {
        authorizationUrl: payload.data.authorization_url,
        accessCode: payload.data.access_code ?? "",
        reference: payload.data.reference ?? reference,
        amount: money(body.amountNgn),
      },
    }
  },
})
