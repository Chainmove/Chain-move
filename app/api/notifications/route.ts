import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseJsonBody, parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import Notification from "@/models/Notification"
import User from "@/models/User"
import { logAuditEvent } from "@/lib/security/audit-log"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { ACTIVITY_CATEGORIES, inferActivityCategory } from "@/lib/activity"
import { createActivity } from "@/lib/services/activity.service"

const querySchema = z.object({
  userId: z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid userId.").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const bodySchema = z.object({
  userId: z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid userId."),
  title: z.string().trim().min(1).max(160),
  message: z.string().trim().min(1).max(2000),
  type: z.string().trim().min(1).max(80).default("info"),
  category: z.enum(ACTIVITY_CATEGORIES).optional(),
  priority: z.enum(["low", "medium", "high"]).default("medium"),
  actionUrl: z
    .string()
    .trim()
    .max(500)
    .refine((value) => value.startsWith("/") || /^https:\/\//i.test(value), "Use an internal path or HTTPS URL.")
    .optional(),
})

export async function POST(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin"], {
      forbiddenMessage: "Admin access required",
    })
    if ("response" in authContext) return authContext.response

    const rateLimit = consumeRateLimit({
      key: buildRateLimitKey("notifications:create", authContext.user._id.toString(), getClientIpAddress(request)),
      limit: 120,
      windowMs: 60 * 60 * 1000,
    })
    if (!rateLimit.allowed) {
      return rateLimitExceededResponse(rateLimit)
    }

    const body = await parseJsonBody(request, bodySchema)
    if ("response" in body) return body.response

    await dbConnect()

    const targetUser = await User.findById(body.data.userId).select("notifications")
    if (!targetUser) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const notification = await createActivity({
      userId: body.data.userId,
      createdBy: authContext.user._id.toString(),
      title: body.data.title,
      message: body.data.message,
      type: body.data.type,
      category: body.data.category || inferActivityCategory(body.data.type),
      priority: body.data.priority,
      link: body.data.actionUrl,
    })

    targetUser.notifications = Array.isArray(targetUser.notifications) ? targetUser.notifications : []
    targetUser.notifications.push({
      id: notification._id.toString(),
      title: body.data.title,
      message: body.data.message,
      read: false,
      timestamp: new Date(),
      link: body.data.actionUrl,
    })
    await targetUser.save()

    await logAuditEvent({
      actor: authContext.user,
      action: "notification.create",
      targetType: "user",
      targetId: body.data.userId,
      ipAddress: getClientIpAddress(request),
      metadata: {
        notificationId: notification._id.toString(),
        type: body.data.type,
        priority: body.data.priority,
      },
    })

    const response = NextResponse.json({ success: true, notification })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("NOTIFICATIONS_POST_ERROR", error)
    return NextResponse.json({ error: "Failed to create notification" }, { status: 500 })
  }
}

export async function GET(request: Request) {
  try {
    const authContext = await requireAuthenticatedUser(request, ["admin", "driver", "investor"])
    if ("response" in authContext) return authContext.response

    const query = parseSearchParams(request, querySchema)
    if ("response" in query) return query.response

    await dbConnect()

    const targetUserId =
      authContext.user.role === "admin" && query.data.userId
        ? query.data.userId
        : authContext.user._id.toString()

    const notifications = await Notification.find({ userId: targetUserId })
      .sort({ timestamp: -1 })
      .limit(query.data.limit)

    const response = NextResponse.json({ success: true, notifications })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("NOTIFICATIONS_GET_ERROR", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}
