import { NextResponse } from "next/server"
import { z } from "zod"

import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseJsonBody, parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import Notification from "@/models/Notification"
import User from "@/models/User"
import { logAuditEvent } from "@/lib/security/audit-log"
import { buildRateLimitKey, consumeRateLimit, getClientIpAddress, rateLimitExceededResponse } from "@/lib/security/rate-limit"
import { decodeCursor, encodeCursor } from "@/lib/api/cursor"
import { ACTIVITY_CATEGORIES, inferActivityCategory } from "@/lib/activity"

const querySchema = z.object({
  userId: z.string().trim().regex(/^[a-f\d]{24}$/i, "Invalid userId.").optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().max(1000).optional(),
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

    // Existence check only: the Notification collection is the single source of
    // truth for notification content and read state, so nothing is written back
    // onto the user document here.
    const recipientExists = await User.exists({ _id: body.data.userId })
    if (!recipientExists) {
      return NextResponse.json({ error: "User not found" }, { status: 404 })
    }

    const notification = await Notification.create({
      userId: body.data.userId,
      createdBy: authContext.user._id.toString(),
      title: body.data.title,
      message: body.data.message,
      type: body.data.type,
      category: body.data.category || inferActivityCategory(body.data.type),
      priority: body.data.priority,
      link: body.data.actionUrl,
    })

    await logAuditEvent({
      actor: authContext.user,
      action: "notification.create",
      targetType: "user",
      targetId: body.data.userId || null,
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

    const scope = `notifications:${targetUserId}`
    let cursor
    try { cursor = decodeCursor(query.data.cursor, scope) }
    catch { return NextResponse.json({ error: "Invalid or expired cursor" }, { status: 400 }) }
    const notificationFilter: Record<string, unknown> = { userId: targetUserId }
    if (cursor) notificationFilter.$or = [{ timestamp: { $lt: cursor.timestamp } }, { timestamp: cursor.timestamp, _id: { $lt: cursor.id } }]
    const notifications = await Notification.find(notificationFilter)
      .select("title message type priority link read timestamp")
      .sort({ timestamp: -1, _id: -1 })
      .limit(query.data.limit + 1).maxTimeMS(1000).lean()

    const hasMore = notifications.length > query.data.limit
    const page = notifications.slice(0, query.data.limit)
    const last = page.at(-1)
    const nextCursor = hasMore && last ? encodeCursor({ timestamp: last.timestamp, id: String(last._id) }, scope) : null

    const response = NextResponse.json({ success: true, notifications: page, nextCursor })
    return finalizeAuthenticatedResponse(response, authContext)
  } catch (error) {
    console.error("NOTIFICATIONS_GET_ERROR", error)
    return NextResponse.json({ error: "Failed to fetch notifications" }, { status: 500 })
  }
}
