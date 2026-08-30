// @vitest-environment node
import { describe, expect, it } from "vitest"

import {
  assertNoForbiddenFields,
  assertNoRawDocuments,
  isForbiddenResponseField,
  money,
  moneyFromMinor,
  redact,
  serializeDate,
  serializeDateTime,
  serializeId,
  ResponseRedactionError,
  RawDocumentError,
} from "@/lib/api/serialization"

describe("forbidden field detection", () => {
  it("matches regardless of casing or separators", () => {
    for (const key of ["password", "passwordHash", "password_hash", "PASSWORD-HASH", "__v"]) {
      expect(isForbiddenResponseField(key)).toBe(true)
    }
  })

  it("does not flag legitimate fields with similar names", () => {
    for (const key of ["passwordUpdatedAt", "tokenCount", "pinnedAt", "description"]) {
      expect(isForbiddenResponseField(key)).toBe(false)
    }
  })

  it("throws on a denied field nested anywhere in the payload", () => {
    expect(() =>
      assertNoForbiddenFields({ users: [{ profile: { passwordHash: "$2b$10$x" } }] }),
    ).toThrow(ResponseRedactionError)

    try {
      assertNoForbiddenFields({ users: [{ profile: { passwordHash: "x" } }] })
    } catch (error) {
      expect((error as ResponseRedactionError).path).toBe("users[0].profile.passwordHash")
    }
  })

  it("accepts a clean payload", () => {
    expect(() =>
      assertNoForbiddenFields({ id: "1", amount: { currency: "NGN", amountMinor: 100 } }),
    ).not.toThrow()
  })

  it("survives a self-referential payload", () => {
    const payload: Record<string, unknown> = { id: "1" }
    payload.self = payload
    expect(() => assertNoForbiddenFields(payload)).not.toThrow()
  })

  it("redacts rather than throws for log payloads", () => {
    expect(redact({ email: "a@b.c", apiKey: "sk_live_123" })).toEqual({
      email: "a@b.c",
      apiKey: "[redacted]",
    })
  })
})

describe("raw document detection", () => {
  it("rejects a hydrated Mongoose document", () => {
    expect(() => assertNoRawDocuments({ pool: { $__: {}, toObject: () => ({}) } })).toThrow(RawDocumentError)
  })

  it("rejects a BSON ObjectId", () => {
    expect(() => assertNoRawDocuments({ id: { _bsontype: "ObjectID" } })).toThrow(RawDocumentError)
  })

  it("accepts plain objects and dates", () => {
    expect(() => assertNoRawDocuments({ id: "1", createdAt: new Date() })).not.toThrow()
  })
})

describe("money serialization", () => {
  it("converts NGN major units to exact minor units", () => {
    expect(money(45000)).toEqual({ currency: "NGN", amountMinor: 4500000, amountMajor: 45000 })
  })

  it("rounds sub-kobo float noise instead of propagating it", () => {
    // 0.1 + 0.2 style drift must not leak into a monetary amount.
    expect(money(1234.565).amountMinor).toBe(123457)
    expect(money(0.1 + 0.2).amountMinor).toBe(30)
  })

  it("honours currencies with non-2 minor unit exponents", () => {
    expect(money(1.5, "XLM")).toEqual({ currency: "XLM", amountMinor: 15000000, amountMajor: 1.5 })
  })

  it("builds from exact minor units without a float round trip", () => {
    expect(moneyFromMinor(4500001)).toEqual({
      currency: "NGN",
      amountMinor: 4500001,
      amountMajor: 45000.01,
    })
  })

  it("coerces missing or non-finite amounts to zero", () => {
    expect(money(undefined).amountMinor).toBe(0)
    expect(money(Number.NaN).amountMinor).toBe(0)
  })
})

describe("date serialization", () => {
  it("emits ISO 8601 UTC timestamps", () => {
    expect(serializeDateTime(new Date("2026-01-31T09:15:00Z"))).toBe("2026-01-31T09:15:00.000Z")
    expect(serializeDateTime("2026-01-31T09:15:00Z")).toBe("2026-01-31T09:15:00.000Z")
  })

  it("emits calendar dates for date-only fields", () => {
    expect(serializeDate("2026-01-31T09:15:00Z")).toBe("2026-01-31")
  })

  it("returns null for absent or invalid values", () => {
    expect(serializeDateTime(null)).toBeNull()
    expect(serializeDateTime(undefined)).toBeNull()
    expect(serializeDateTime("not a date")).toBeNull()
  })
})

describe("id serialization", () => {
  it("normalizes strings, ObjectIds, and populated references", () => {
    expect(serializeId("665f1a2b3c4d5e6f70819203")).toBe("665f1a2b3c4d5e6f70819203")
    expect(serializeId({ toString: () => "665f1a2b3c4d5e6f70819203" })).toBe("665f1a2b3c4d5e6f70819203")
    expect(serializeId({ _id: { toString: () => "abc" }, email: "a@b.c" })).toBe("abc")
    expect(serializeId(null)).toBeNull()
  })
})
