import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseJsonBody } from "@/lib/api/validation"
import { logAuditEvent } from "@/lib/security/audit-log"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import {
  EmailConfigurationError,
  EmailDeliveryError,
  sendEmail,
  type SendEmailResult,
} from "@/lib/services/email.service"

function normalizeRecipients(value: unknown) {
  const items = Array.isArray(value) ? value : [value]
  return items
    .map((item) => (typeof item === "string" ? item.trim().toLowerCase() : ""))
    .filter(Boolean)
    .slice(0, 10)
}

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
}

const bodySchema = z.object({
  to: z.union([z.string(), z.array(z.string())]),
  subject: z.string().trim().min(1).max(160),
  html: z.string().trim().min(1).max(50000),
})

export async function POST(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin"], {
      forbiddenMessage: "Admin access required",
    })
    if ("response" in authContext) return authContext.response

    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("send-email", authContext.user._id.toString(), getClientIpAddress(request)),
      limit: 20,
      windowMs: 60 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const body = await parseJsonBody(request, bodySchema)
    if ("response" in body) return body.response

    const recipients = normalizeRecipients(body.data.to)
    const subject = body.data.subject
    const html = body.data.html

    if (recipients.length === 0 || recipients.some((recipient) => !isValidEmail(recipient))) {
      return NextResponse.json({ error: "A valid recipient email is required" }, { status: 400 })
    }

    if (!subject || subject.length > 160) {
      return NextResponse.json({ error: "A valid subject is required" }, { status: 400 })
    }

    if (!html || html.length > 50000) {
      return NextResponse.json({ error: "Email content is required" }, { status: 400 })
    }

    let data: SendEmailResult
    try {
      data = await sendEmail({ to: recipients, subject, html })
    } catch (error) {
      if (error instanceof EmailConfigurationError) {
        return NextResponse.json({ error: error.message }, { status: 500 })
      }
      if (!(error instanceof EmailDeliveryError)) throw error

      console.error("RESEND_EMAIL_ERROR", error)
      await logAuditEvent({
        actor: authContext.user,
        action: "email.send",
        targetType: "email",
        status: "failure",
        ipAddress: getClientIpAddress(request),
        metadata: {
          recipientsCount: recipients.length,
          subject,
          providerError: error.message,
        },
      })
      return NextResponse.json({ error: "Unable to send email" }, { status: 502 })
    }

    await logAuditEvent({
      actor: authContext.user,
      action: "email.send",
      targetType: "email",
      status: "success",
      ipAddress: getClientIpAddress(request),
      metadata: {
        recipientsCount: recipients.length,
        subject,
        mocked: data.mocked,
      },
    })

    const response = NextResponse.json({ success: true, data }, { status: 200 })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("SEND_EMAIL_ROUTE_ERROR", error)
    return NextResponse.json({ error: "Internal server error" }, { status: 500 })
  }
}
