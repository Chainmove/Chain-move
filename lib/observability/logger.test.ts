import { describe, expect, it } from "vitest"

import { redact } from "@/lib/observability/logger"

describe("observability redaction", () => {
  it("redacts nested secrets, KYC data, and provider payloads", () => {
    expect(
      redact({ authorization: "Bearer secret", nested: { apiKey: "key", kycDocument: { bvn: "123" } }, events: [{ accountNumber: "456" }] }),
    ).toEqual({
      authorization: "[REDACTED]",
      nested: { apiKey: "[REDACTED]", kycDocument: "[REDACTED]" },
      events: [{ accountNumber: "[REDACTED]" }],
    })
  })

  it("serializes errors without arbitrary properties", () => {
    const error = new Error("provider unavailable")
    ;(error as Error & { token?: string }).token = "do-not-log"
    expect(redact({ error })).toMatchObject({ error: { name: "Error", message: "provider unavailable" } })
  })
})
