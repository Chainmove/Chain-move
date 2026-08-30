import { createHmac, timingSafeEqual } from "node:crypto"

const VERSION = 1
const TTL_MS = 15 * 60 * 1000
function secret() {
  const value = process.env.CURSOR_SIGNING_SECRET || process.env.JWT_SECRET
  if (!value) throw new Error("CURSOR_SIGNING_SECRET is required")
  return value
}
function sign(payload: string) { return createHmac("sha256", secret()).update(payload).digest("base64url") }

export function encodeCursor(position: { timestamp: Date; id: string }, scope: string) {
  const payload = Buffer.from(JSON.stringify({ v: VERSION, ts: position.timestamp.toISOString(), id: position.id, scope, exp: Date.now() + TTL_MS })).toString("base64url")
  return `${payload}.${sign(payload)}`
}

export function decodeCursor(value: string | undefined, scope: string) {
  if (!value) return null
  const [payload, signature] = value.split(".")
  if (!payload || !signature) throw new Error("Invalid cursor")
  const expected = sign(payload)
  if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error("Invalid cursor signature")
  const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"))
  if (data.v !== VERSION || data.scope !== scope || data.exp < Date.now() || !/^[a-f\d]{24}$/i.test(data.id)) throw new Error("Expired or incompatible cursor")
  return { timestamp: new Date(data.ts), id: data.id }
}
