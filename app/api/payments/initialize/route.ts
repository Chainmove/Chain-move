import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseJsonBody } from "@/lib/api/validation"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"

function resolveCallbackUrl(request: Request) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || new URL(request.url).origin
  return `${appUrl}/dashboard/investor`
}

const bodySchema = z
  .object({
    amount: z.preprocess(
      (value) => (value === null || typeof value === "undefined" || value === "" ? undefined : Number(value)),
      z.number().positive().max(100_000_000).optional(),
    ),
    amountNgn: z.preprocess(
      (value) => (value === null || typeof value === "undefined" || value === "" ? undefined : Number(value)),
      z.number().positive().max(100_000_000).optional(),
    ),
    email: z.string().trim().email().max(254).optional(),
  })
  .strict()
  .refine((value) => typeof value.amount === "number" || typeof value.amountNgn === "number", {
    message: "A valid amount is required.",
    path: ["amountNgn"],
  })

export async function POST(request: Request) {
  const secretKey = process.env.PAYSTACK_SECRET_KEY
  if (!secretKey) {
    return NextResponse.json({ message: "Paystack is not configured." }, { status: 500 })
  }

  try {
    const authContext = await requireAuthenticatedUser(request)
    if ("response" in authContext) return authContext.response

    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("payments:initialize", authContext.user._id.toString(), getClientIpAddress(request)),
      limit: 10,
      windowMs: 10 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const body = await parseJsonBody(request, bodySchema)
    if ("response" in body) return body.response

    const amountNgn = body.data.amountNgn ?? body.data.amount ?? 0
    const providedEmail = body.data.email?.trim().toLowerCase() || ""
    const fundingEmail = (authContext.user.email || providedEmail || "").trim().toLowerCase()
    if (!fundingEmail) {
      return NextResponse.json({ message: "An email is required for Paystack funding." }, { status: 400 })
    }

    const amountInKobo = Math.round(amountNgn * 100)
    const reference = `cm_wallet_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

    const paystackResponse = await fetch("https://api.paystack.co/transaction/initialize", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${secretKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: amountInKobo,
        email: fundingEmail,
        reference,
        callback_url: resolveCallbackUrl(request),
        metadata: {
          paymentType: "wallet_funding",
          userId: authContext.user._id.toString(),
          role: authContext.user.role,
          amountNgn,
          payerEmail: fundingEmail,
        },
      }),
    })

    const payload = await paystackResponse.json()
    if (!paystackResponse.ok || payload?.status === false) {
      const message = payload?.message || "Failed to initialize payment."
      return NextResponse.json({ message }, { status: 500 })
    }

    const response = NextResponse.json(payload)
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("PAYSTACK_INITIALIZE_ERROR", error)
    return NextResponse.json({ message: "Failed to initialize payment." }, { status: 500 })
  }
}
