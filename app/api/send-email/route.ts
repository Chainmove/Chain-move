import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseJsonBody, validationErrorResponse } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import User from "@/models/User"
import { logAuditEvent } from "@/lib/security/audit-log"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { EMAIL_TEMPLATES, renderEmailTemplate, type EmailTemplateId } from "@/lib/services/email-templates"
import {
  EmailConfigurationError,
  EmailDeliveryError,
  sendEmail,
  type SendEmailResult,
} from "@/lib/services/email.service"

const templateIds = Object.keys(EMAIL_TEMPLATES) as [EmailTemplateId, ...EmailTemplateId[]]

const bodySchema = z.object({
  userId: z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid userId."),
  templateId: z.enum(templateIds),
  variables: z.record(z.string(), z.unknown()).default({}),
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

    const { userId, templateId, variables } = body.data

    await dbConnect()
    const recipient = await User.findById(userId).select("email").lean<{ email?: string }>()
    if (!recipient?.email) {
      return NextResponse.json({ error: "Recipient not found" }, { status: 400 })
    }

    let subject: string
    let html: string
    try {
      ;({ subject, html } = renderEmailTemplate(templateId, variables))
    } catch (error) {
      if (error instanceof z.ZodError) {
        return validationErrorResponse("Invalid template variables.", error)
      }
      throw error
    }

    let data: SendEmailResult
    try {
      data = await sendEmail({ to: recipient.email, subject, html })
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
          recipientUserId: userId,
          templateId,
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
        recipientUserId: userId,
        templateId,
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
