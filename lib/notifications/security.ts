import { createHmac, timingSafeEqual } from "node:crypto"
import type { NotificationCategory } from "./types"
type Payload = { userId: string; category: NotificationCategory; channel: "email"; exp: number }
export function createPreferenceToken(payload: Payload, secret = process.env.NOTIFICATION_TOKEN_SECRET || process.env.JWT_SECRET) {
  if (!secret) throw new Error("Notification token secret is not configured")
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  return `${body}.${createHmac("sha256", secret).update(body).digest("base64url")}`
}
export function verifyPreferenceToken(token: string, secret = process.env.NOTIFICATION_TOKEN_SECRET || process.env.JWT_SECRET, now = Date.now()): Payload {
  if (!secret) throw new Error("Notification token secret is not configured")
  const [body, sig] = token.split("."); if (!body || !sig) throw new Error("Invalid preference token")
  const expected = createHmac("sha256", secret).update(body).digest(), actual = Buffer.from(sig, "base64url")
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error("Invalid preference token")
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as Payload
  if (!payload.userId || payload.channel !== "email" || payload.exp <= Math.floor(now / 1000)) throw new Error("Expired preference token")
  return payload
}
