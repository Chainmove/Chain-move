import { NextResponse } from "next/server"
import { z } from "zod"

import { ACTIVITY_CATEGORIES, inferActivityCategory, type ActivityCategory } from "@/lib/activity"
import { finalizeAuthenticatedResponse, requireAuthenticatedUser } from "@/lib/api/route-guard"
import { parseJsonBody, parseSearchParams } from "@/lib/api/validation"
import dbConnect from "@/lib/dbConnect"
import Notification from "@/models/Notification"

const querySchema = z.object({
  category: z.enum(ACTIVITY_CATEGORIES).optional(),
  unread: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
})

const updateSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("mark-all-read") }),
  z.object({
    action: z.literal("set-read"),
    activityId: z.string().regex(/^[a-f\d]{24}$/i, "Invalid activityId."),
    read: z.boolean(),
  }),
])

function serializeActivity(notification: any) {
  const storedCategory = notification.category as ActivityCategory | undefined
  return {
    id: notification._id.toString(),
    title: notification.title,
    message: notification.message,
    category: storedCategory || inferActivityCategory(notification.type),
    priority: notification.priority,
    link: notification.link,
    read: notification.read,
    timestamp: notification.timestamp.toISOString(),
  }
}

export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request, ["admin", "driver", "investor"])
    if ("response" in auth) return auth.response

    const query = parseSearchParams(request, querySchema)
    if ("response" in query) return query.response

    await dbConnect()
    const filter: Record<string, unknown> = { userId: auth.user._id.toString() }
    if (query.data.category) filter.category = query.data.category
    if (query.data.unread) filter.read = query.data.unread === "true"

    const [notifications, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ timestamp: -1 }).limit(query.data.limit).lean(),
      Notification.countDocuments({ userId: auth.user._id.toString(), read: false }),
    ])

    const response = NextResponse.json({
      activities: notifications.map(serializeActivity),
      unreadCount,
    })
    return finalizeAuthenticatedResponse(response, auth)
  } catch (error) {
    console.error("ACTIVITY_GET_ERROR", error)
    return NextResponse.json({ error: "Failed to fetch activity" }, { status: 500 })
  }
}

export async function PATCH(request: Request) {
  try {
    const auth = await requireAuthenticatedUser(request, ["admin", "driver", "investor"])
    if ("response" in auth) return auth.response

    const body = await parseJsonBody(request, updateSchema)
    if ("response" in body) return body.response

    await dbConnect()
    const userId = auth.user._id.toString()
    if (body.data.action === "mark-all-read") {
      await Notification.updateMany({ userId, read: false }, { $set: { read: true } })
    } else {
      const result = await Notification.updateOne(
        { _id: body.data.activityId, userId },
        { $set: { read: body.data.read } },
      )
      if (!result.matchedCount) return NextResponse.json({ error: "Activity not found" }, { status: 404 })
    }

    const unreadCount = await Notification.countDocuments({ userId, read: false })
    const response = NextResponse.json({ success: true, unreadCount })
    return finalizeAuthenticatedResponse(response, auth)
  } catch (error) {
    console.error("ACTIVITY_PATCH_ERROR", error)
    return NextResponse.json({ error: "Failed to update activity" }, { status: 500 })
  }
}
