import { describe, expect, it } from "vitest"
import { retryDecision, markRead } from "../policy"
import { renderNotification } from "../render"
import { createPreferenceToken, verifyPreferenceToken } from "../security"
import { enabledChannels, redactError } from "../service"
import { safeApplicationUrl } from "../templates"

const event = { type: "kyc.decision", version: 1, eventId: "kyc:user:approved", userId: "507f1f77bcf86cd799439011", occurredAt: "2026-01-01T00:00:00Z", payload: { decision: "approved" } } as const

describe("notification domain", () => {
  it("respects preferences for optional events", () => expect(enabledChannels({ category: "funding", mandatory: false }, { locale: "en", categories: { funding: { email: false } } })).toEqual(["in_app"]))
  it("keeps mandatory notices enabled", () => expect(enabledChannels({ category: "kyc", mandatory: true }, { locale: "en", categories: { kyc: { email: false, in_app: false } } })).toEqual(["in_app", "email"]))
  it("uses a deterministic per-channel idempotency shape", () => expect(`${event.eventId}:${event.userId}:email`).toBe(`${event.eventId}:${event.userId}:email`))
  it("renders deterministically without sensitive KYC details", () => { expect(renderNotification(event)).toEqual(renderNotification(event)); expect(renderNotification(event).html).not.toMatch(/document|passport|secret/i) })
  it("validates template payloads", () => expect(() => renderNotification({ ...event, payload: { decision: "unknown" as never } })).toThrow())
  it("rejects unsafe links", () => { expect(() => safeApplicationUrl("//evil.example", "https://chainmove.xyz")).toThrow(); expect(() => safeApplicationUrl("/ok", "http://evil.example")).toThrow() })
  it("expires scoped preference tokens", () => { const token = createPreferenceToken({ userId: event.userId, category: "funding", channel: "email", exp: 10 }, "secret"); expect(verifyPreferenceToken(token, "secret", 9_000).category).toBe("funding"); expect(() => verifyPreferenceToken(token, "secret", 11_000)).toThrow("Expired") })
  it("backs off before entering dead letter", () => { const retry = retryDecision(0, 3, new Date(0)); expect(retry.status).toBe("scheduled"); expect(retry.scheduledFor?.getTime()).toBe(60_000); expect(retryDecision(2, 3).status).toBe("dead_letter") })
  it("changes only selected notifications to read", () => expect(markRead([{ id: "a", read: false }, { id: "b", read: false }], ["a"])).toEqual([{ id: "a", read: true }, { id: "b", read: false }]))
  it("redacts PII and secrets from provider errors", () => expect(redactError(new Error("john@example.com token=abc document=passport"))).toBe("[REDACTED_EMAIL] token=[REDACTED] document=[REDACTED]"))
})
