// @vitest-environment node
import { describe, expect, it } from "vitest"
import { z } from "zod"

import {
  API_ERROR_CODES,
  ApiError,
  ApiErrorSchema,
  fieldErrorsFromZod,
  normalizeError,
  resolveCorrelationId,
} from "@/lib/api/errors"

describe("error envelope", () => {
  it("carries a code, safe message, and correlation id", () => {
    const envelope = ApiError.forbidden().toEnvelope("corr-1")

    expect(ApiErrorSchema.parse(envelope)).toEqual({
      code: "FORBIDDEN",
      message: "Access denied.",
      correlationId: "corr-1",
    })
  })

  it("publishes field errors alongside the deprecated issues alias", () => {
    const envelope = ApiError.validation([
      { path: "amountNgn", message: "Must be positive.", code: "too_small" },
    ]).toEnvelope("corr-2")

    expect(envelope.fieldErrors).toEqual([
      { path: "amountNgn", message: "Must be positive.", code: "too_small" },
    ])
    // Retained so existing clients reading `issues` keep working. See
    // docs/api-migration.md.
    expect(envelope.issues).toEqual([{ path: "amountNgn", message: "Must be positive." }])
  })

  it("never serializes the underlying cause", () => {
    const envelope = ApiError.internal(new Error("mongodb://admin:hunter2@db:27017")).toEnvelope("corr-3")

    expect(JSON.stringify(envelope)).not.toContain("hunter2")
    expect(Object.keys(envelope).sort()).toEqual(["code", "correlationId", "message"])
  })

  it("keeps every documented code mapped to a status", () => {
    for (const code of API_ERROR_CODES) {
      const status = new ApiError(code).status
      expect(status).toBeGreaterThanOrEqual(400)
      expect(status).toBeLessThan(600)
    }
  })
})

describe("field errors from Zod", () => {
  it("formats nested and indexed paths", () => {
    const schema = z.object({
      pool: z.object({ contributions: z.array(z.object({ amount: z.number() })) }),
    })

    const result = schema.safeParse({ pool: { contributions: [{ amount: "x" }] } })
    expect(result.success).toBe(false)

    if (!result.success) {
      expect(fieldErrorsFromZod(result.error)[0].path).toBe("pool.contributions[0].amount")
    }
  })

  it("labels whole-payload failures as root", () => {
    const result = z.object({ a: z.string() }).safeParse("not-an-object")
    expect(result.success).toBe(false)

    if (!result.success) {
      expect(fieldErrorsFromZod(result.error)[0].path).toBe("root")
    }
  })
})

describe("normalizeError", () => {
  it("passes ApiError through unchanged", () => {
    const original = ApiError.notFound("Pool not found.")
    expect(normalizeError(original)).toBe(original)
  })

  it("maps a ZodError to a validation failure", () => {
    const result = z.object({ amount: z.number() }).safeParse({})
    if (result.success) throw new Error("expected failure")

    const normalized = normalizeError(result.error)
    expect(normalized.code).toBe("VALIDATION_FAILED")
    expect(normalized.status).toBe(400)
  })

  it("maps an opted-in service error to its declared code", () => {
    const normalized = normalizeError({
      apiErrorCode: "UNPROCESSABLE",
      message: "Your profile is missing a phone number.",
      code: "DVA_PROFILE_INCOMPLETE",
    })

    expect(normalized.code).toBe("UNPROCESSABLE")
    expect(normalized.message).toBe("Your profile is missing a phone number.")
  })

  it("refuses to expose a provider error that only carries a status code", () => {
    // Shape of `DriverVirtualAccountProvisionError` before it opts in: having a
    // `statusCode` must not be enough to publish the message.
    const providerError = Object.assign(new Error("Paystack: customer 4471 failed KYC check"), {
      statusCode: 400,
      code: "DRIVER_VIRTUAL_ACCOUNT_ERROR",
    })

    const normalized = normalizeError(providerError)

    expect(normalized.code).toBe("INTERNAL_ERROR")
    expect(normalized.message).not.toContain("4471")
  })

  it("maps transient and duplicate-key database errors", () => {
    expect(normalizeError(Object.assign(new Error("x"), { code: 251 })).code).toBe("TRANSIENT_CONFLICT")
    expect(
      normalizeError(Object.assign(new Error("x"), { errorLabels: ["UnknownTransactionCommitResult"] })).code,
    ).toBe("TRANSIENT_CONFLICT")

    const duplicate = normalizeError(
      Object.assign(new Error("E11000 duplicate key error index: email_1 dup key"), { code: 11000 }),
    )
    expect(duplicate.status).toBe(409)
    expect(duplicate.message).not.toContain("email_1")
  })

  it("maps a mongoose validation error without echoing internal paths", () => {
    const normalized = normalizeError({
      name: "ValidationError",
      errors: { assetType: { kind: "required", message: "Path `assetType` is required." } },
    })

    expect(normalized.code).toBe("VALIDATION_FAILED")
    expect(normalized.fieldErrors).toEqual([{ path: "assetType", message: "This field is required." }])
  })

  it("treats anything unrecognized as an internal error", () => {
    for (const value of ["a string", 42, null, undefined, { message: "plain object" }]) {
      expect(normalizeError(value).code).toBe("INTERNAL_ERROR")
    }
  })
})

describe("correlation ids", () => {
  it("adopts a well-formed inbound trace id", () => {
    const request = new Request("https://chainmove.test/api/thing", {
      headers: { "x-request-id": "abc-123-def" },
    })
    expect(resolveCorrelationId(request)).toBe("abc-123-def")
  })

  it("generates a fresh id when the inbound value is unusable", () => {
    const request = new Request("https://chainmove.test/api/thing", {
      headers: { "x-correlation-id": "bad value with spaces" },
    })
    expect(resolveCorrelationId(request)).toMatch(/^[0-9a-f-]{36}$/)
  })
})
