import { NextResponse } from "next/server"

import { getSessionFromCookies } from "@/lib/auth/session"
import dbConnect from "@/lib/dbConnect"
import { replayWebhookEvent, purgeOldWebhookEvents } from "@/lib/services/webhook-inbox.service"
import User from "@/models/User"
import WebhookInboxEvent from "@/models/WebhookInboxEvent"

async function requireAdmin(): Promise<{ id: string } | null> {
  const session = await getSessionFromCookies()
  if (!session?.userId) return null
  await dbConnect()
  const user = await User.findById(session.userId).select("role").lean()
  if (!user || user.role !== "admin") return null
  return { id: user._id.toString() }
}

/** GET /api/admin/webhook-inbox — list events with optional status filter */
export async function GET(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ message: "Forbidden." }, { status: 403 })

  const url = new URL(request.url)
  const status = url.searchParams.get("status") ?? undefined
  const limit = Math.min(Number(url.searchParams.get("limit") ?? "50"), 200)

  const filter: Record<string, unknown> = {}
  if (status) filter.status = status

  const events = await WebhookInboxEvent.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()

  return NextResponse.json({ events }, { status: 200 })
}

/** POST /api/admin/webhook-inbox — replay or purge */
export async function POST(request: Request) {
  const admin = await requireAdmin()
  if (!admin) return NextResponse.json({ message: "Forbidden." }, { status: 403 })

  const body = await request.json()
  const { action, inboxId, reason, retentionDays } = body as {
    action: string
    inboxId?: string
    reason?: string
    retentionDays?: number
  }

  if (action === "replay") {
    if (!inboxId || !reason) {
      return NextResponse.json({ message: "inboxId and reason are required for replay." }, { status: 400 })
    }
    const result = await replayWebhookEvent(inboxId, {
      adminUserId: admin.id,
      reason,
    })
    return NextResponse.json(result, { status: 200 })
  }

  if (action === "purge") {
    const deleted = await purgeOldWebhookEvents(retentionDays ?? 90)
    return NextResponse.json({ deleted }, { status: 200 })
  }

  return NextResponse.json({ message: `Unknown action: ${action}` }, { status: 400 })
}
