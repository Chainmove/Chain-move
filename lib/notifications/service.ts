import { Resend } from "resend"
import dbConnect from "@/lib/dbConnect"
import Notification from "@/models/Notification"
import NotificationDelivery from "@/models/NotificationDelivery"
import NotificationPreference from "@/models/NotificationPreference"
import User from "@/models/User"
import { renderNotification } from "./render"
import type { NotificationChannel, NotificationEvent, NotificationPreferences } from "./types"

export function enabledChannels(rendered: { category: string; mandatory: boolean }, preferences?: NotificationPreferences): NotificationChannel[] {
  const selected = preferences?.categories[rendered.category as keyof NotificationPreferences["categories"]]
  return (["in_app", "email"] as const).filter(channel => rendered.mandatory || selected?.[channel] !== false)
}

export async function publishNotificationEvent(event: NotificationEvent, scheduledFor = new Date()) {
  await dbConnect()
  const [user, preference] = await Promise.all([User.findById(event.userId).select("email").lean<{ email?: string }>(), NotificationPreference.findOne({ userId: event.userId }).lean()])
  if (!user) throw new Error("Notification recipient not found")
  const rendered = renderNotification(event)
  const channels = enabledChannels(rendered, preference as unknown as NotificationPreferences)
  const results: unknown[] = []
  for (const channel of channels) {
    if (channel === "email" && !user.email) continue
    const idempotencyKey = `${event.eventId}:${event.userId}:${channel}`
    const delivery = await NotificationDelivery.findOneAndUpdate({ idempotencyKey }, { $setOnInsert: {
      idempotencyKey, eventId: event.eventId, eventType: event.type, userId: event.userId, channel,
      category: rendered.category, mandatory: rendered.mandatory, templateKey: rendered.templateKey,
      templateVersion: rendered.templateVersion, to: channel === "email" ? user.email : undefined,
      subject: channel === "email" ? rendered.subject : undefined, html: channel === "email" ? rendered.html : undefined,
      status: channel === "email" ? "scheduled" : "created", scheduledFor,
    } }, { upsert: true, new: true })
    const inAppClaim = channel === "in_app"
      ? await NotificationDelivery.findOneAndUpdate({ _id: delivery._id, notificationId: { $exists: false }, status: "created" }, { $set: { status: "processing", lockedAt: new Date() } }, { new: true })
      : null
    if (inAppClaim) {
      const notification = await Notification.create({ userId: event.userId, title: rendered.title, message: rendered.text, type: rendered.category, priority: rendered.mandatory ? "high" : "medium", link: new URL(rendered.actionUrl).pathname })
      await NotificationDelivery.updateOne({ _id: inAppClaim._id }, { $set: { notificationId: notification._id, status: "delivered", deliveredAt: new Date() } })
    }
    results.push(delivery)
  }
  return results
}

export interface EmailProvider { send(input: { to: string; subject: string; html: string; idempotencyKey: string }): Promise<{ id: string }> }
export async function processEmailJobs(provider: EmailProvider = resendProvider(), now = new Date(), limit = 25) {
  const summary = { delivered: 0, retried: 0, deadLettered: 0 }
  await dbConnect()
  for (let i = 0; i < limit; i++) {
    const job = await NotificationDelivery.findOneAndUpdate({ channel: "email", status: "scheduled", scheduledFor: { $lte: now } }, { $set: { status: "processing", lockedAt: now } }, { sort: { scheduledFor: 1 }, new: true })
    if (!job) break
    try {
      const response = await provider.send({ to: job.to, subject: job.subject, html: job.html, idempotencyKey: job.idempotencyKey })
      await NotificationDelivery.updateOne({ _id: job._id }, { $set: { status: "delivered", providerId: response.id, deliveredAt: now }, $inc: { attemptCount: 1 }, $push: { attempts: { attemptedAt: now, status: "delivered", providerId: response.id } } })
      summary.delivered++
    } catch (error) {
      const count = job.attemptCount + 1, dead = count >= job.maxAttempts
      await NotificationDelivery.updateOne({ _id: job._id }, { $set: { status: dead ? "dead_letter" : "scheduled", scheduledFor: new Date(now.getTime() + Math.min(3600, 30 * 2 ** count) * 1000), ...(dead ? { failedAt: now } : {}) }, $inc: { attemptCount: 1 }, $push: { attempts: { attemptedAt: now, status: "failed", error: redactError(error) } } })
      dead ? summary.deadLettered++ : summary.retried++
    }
  }
  return summary
}

export function redactError(error: unknown) {
  const value = error instanceof Error ? error.message : "Provider failure"
  return value.replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[REDACTED_EMAIL]").replace(/(secret|token|key|document)[=: ]+\S+/gi, "$1=[REDACTED]").slice(0, 500)
}
function resendProvider(): EmailProvider {
  return { async send(input) {
    if (process.env.ENABLE_MOCK_EMAILS === "true") return { id: `mock-${input.idempotencyKey}` }
    if (!process.env.RESEND_API_KEY) throw new Error("Email provider is not configured")
    const { data, error } = await new Resend(process.env.RESEND_API_KEY).emails.send({ from: "ChainMove <onboarding@chainmove.xyz>", to: input.to, subject: input.subject, html: input.html }, { idempotencyKey: input.idempotencyKey })
    if (error || !data) throw new Error(error?.message || "Email provider failure")
    return { id: data.id }
  } }
}
