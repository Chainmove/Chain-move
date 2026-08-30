// @vitest-environment node
import { describe, expect, it } from "vitest"

import { compareOpenApiDocuments, evaluateCompatibility, type CompatChange } from "@/lib/api/compat"

type Doc = Record<string, any>

/** Builds a one-operation document so each case isolates a single edit. */
function doc(operation: Doc): Doc {
  return { paths: { "/api/pools": { post: { security: [{ sessionCookie: [] }], ...operation } } } }
}

function requestBody(schema: Doc): Doc {
  return { requestBody: { content: { "application/json": { schema } } } }
}

function response(schema: Doc, status = "201"): Doc {
  return { responses: { [status]: { content: { "application/json": { schema } } } } }
}

function breakingIds(previous: Doc, current: Doc): string[] {
  return compareOpenApiDocuments(previous, current)
    .filter((change: CompatChange) => change.kind === "breaking")
    .map((change) => change.detail)
}

describe("path and operation removal", () => {
  it("flags a removed path", () => {
    expect(breakingIds(doc({}), { paths: {} })).toEqual([expect.stringContaining("was removed")])
  })

  it("flags a removed method on a surviving path", () => {
    expect(breakingIds(doc({}), { paths: { "/api/pools": { get: {} } } })).toEqual([
      expect.stringContaining("POST /api/pools was removed"),
    ])
  })

  it("flags a removed documented response status", () => {
    const previous = doc(response({ type: "object" }, "201"))
    const current = doc({ responses: {} })

    expect(breakingIds(previous, current)).toEqual([expect.stringContaining("status 201 was removed")])
  })

  it("flags newly required authentication", () => {
    const previous = { paths: { "/api/pools": { post: { security: [] } } } }
    const current = doc({})

    expect(breakingIds(previous, current)).toEqual([
      expect.stringContaining('requires security scheme "sessionCookie"'),
    ])
  })
})

describe("request schemas are contravariant", () => {
  const base = { type: "object", properties: { amount: { type: "number" } }, required: ["amount"] }

  it("flags a new required property", () => {
    const current = {
      type: "object",
      properties: { amount: { type: "number" }, currency: { type: "string" } },
      required: ["amount", "currency"],
    }

    expect(breakingIds(doc(requestBody(base)), doc(requestBody(current)))).toEqual([
      expect.stringContaining('New required request property "currency"'),
    ])
  })

  it("allows a new optional property", () => {
    const current = {
      type: "object",
      properties: { amount: { type: "number" }, note: { type: "string" } },
      required: ["amount"],
    }

    expect(breakingIds(doc(requestBody(base)), doc(requestBody(current)))).toEqual([])
  })

  it("flags an optional property becoming required", () => {
    const previous = { type: "object", properties: { txRef: { type: "string" } } }
    const current = { type: "object", properties: { txRef: { type: "string" } }, required: ["txRef"] }

    expect(breakingIds(doc(requestBody(previous)), doc(requestBody(current)))).toEqual([
      expect.stringContaining('"txRef" is now required'),
    ])
  })

  it("flags a property no longer accepted by a strict schema", () => {
    const previous = { type: "object", properties: { amount: {}, legacy: {} }, additionalProperties: false }
    const current = { type: "object", properties: { amount: {} }, additionalProperties: false }

    expect(breakingIds(doc(requestBody(previous)), doc(requestBody(current)))).toEqual([
      expect.stringContaining('"legacy" is no longer accepted'),
    ])
  })

  it("flags a narrowed accepted enum but allows a widened one", () => {
    const wide = { type: "object", properties: { status: { enum: ["OPEN", "CLOSED"] } } }
    const narrow = { type: "object", properties: { status: { enum: ["OPEN"] } } }

    expect(breakingIds(doc(requestBody(wide)), doc(requestBody(narrow)))).toEqual([
      expect.stringContaining("no longer accepts enum value(s): CLOSED"),
    ])
    expect(breakingIds(doc(requestBody(narrow)), doc(requestBody(wide)))).toEqual([])
  })

  it("flags a dropped accepted type but allows an added one", () => {
    const wide = { type: "object", properties: { amount: { type: ["number", "string"] } } }
    const narrow = { type: "object", properties: { amount: { type: "number" } } }

    expect(breakingIds(doc(requestBody(wide)), doc(requestBody(narrow)))).toEqual([
      expect.stringContaining("no longer accepts type string"),
    ])
    expect(breakingIds(doc(requestBody(narrow)), doc(requestBody(wide)))).toEqual([])
  })
})

describe("response schemas are covariant", () => {
  const base = {
    type: "object",
    properties: { id: { type: "string" }, amountNgn: { type: "number" } },
    required: ["id", "amountNgn"],
  }

  it("flags a removed guaranteed property", () => {
    const current = { type: "object", properties: { id: { type: "string" } }, required: ["id"] }

    expect(breakingIds(doc(response(base)), doc(response(current)))).toEqual([
      expect.stringContaining('Response property "amountNgn" was removed'),
    ])
  })

  it("allows a new response property", () => {
    const current = {
      type: "object",
      properties: { id: { type: "string" }, amountNgn: { type: "number" }, amountMinor: { type: "integer" } },
      required: ["id", "amountNgn"],
    }

    expect(breakingIds(doc(response(base)), doc(response(current)))).toEqual([])
  })

  it("flags a property that is no longer guaranteed to be present", () => {
    const current = {
      type: "object",
      properties: { id: { type: "string" }, amountNgn: { type: "number" } },
      required: ["id"],
    }

    expect(breakingIds(doc(response(base)), doc(response(current)))).toEqual([
      expect.stringContaining('"amountNgn" is no longer guaranteed'),
    ])
  })

  it("flags a money unit change hidden behind a type swap", () => {
    const current = {
      type: "object",
      properties: { id: { type: "string" }, amountNgn: { type: "string" } },
      required: ["id", "amountNgn"],
    }

    expect(breakingIds(doc(response(base)), doc(response(current)))).toEqual([
      expect.stringContaining("Response type widened to include string"),
    ])
  })

  it("flags a newly returnable enum value but allows a narrowed one", () => {
    const narrow = { type: "object", properties: { status: { enum: ["OPEN"] } } }
    const wide = { type: "object", properties: { status: { enum: ["OPEN", "SUSPENDED"] } } }

    expect(breakingIds(doc(response(narrow)), doc(response(wide)))).toEqual([
      expect.stringContaining("may now return new enum value(s): SUSPENDED"),
    ])
    expect(breakingIds(doc(response(wide)), doc(response(narrow)))).toEqual([])
  })

  it("descends into arrays", () => {
    const previous = doc(
      response({ type: "array", items: { type: "object", properties: { id: {} }, required: ["id"] } }),
    )
    const current = doc(response({ type: "array", items: { type: "object", properties: {} } }))

    expect(breakingIds(previous, current)).toEqual([
      expect.stringContaining('Response property "id" was removed'),
    ])
  })
})

describe("query parameters", () => {
  const previous = doc({ parameters: [{ name: "status", in: "query", required: false, schema: {} }] })

  it("flags a removed parameter", () => {
    expect(breakingIds(previous, doc({ parameters: [] }))).toEqual([
      expect.stringContaining('Parameter "query:status" was removed'),
    ])
  })

  it("flags a parameter becoming required", () => {
    const current = doc({ parameters: [{ name: "status", in: "query", required: true, schema: {} }] })

    expect(breakingIds(previous, current)).toEqual([expect.stringContaining("is now required")])
  })

  it("flags a new required parameter but allows a new optional one", () => {
    const withRequired = doc({
      parameters: [
        { name: "status", in: "query", required: false, schema: {} },
        { name: "tenantId", in: "query", required: true, schema: {} },
      ],
    })
    const withOptional = doc({
      parameters: [
        { name: "status", in: "query", required: false, schema: {} },
        { name: "search", in: "query", required: false, schema: {} },
      ],
    })

    expect(breakingIds(previous, withRequired)).toEqual([
      expect.stringContaining('New required parameter "query:tenantId"'),
    ])
    expect(breakingIds(previous, withOptional)).toEqual([])
  })
})

describe("approval workflow", () => {
  const change: CompatChange = {
    kind: "breaking",
    id: "removed-property POST /api/pools responses.201.amountNgn",
    operation: "POST /api/pools",
    pointer: "responses.201.amountNgn",
    detail: "Response property was removed.",
  }

  it("blocks an unapproved breaking change", () => {
    const result = evaluateCompatibility([change], [])

    expect(result.breaking).toHaveLength(1)
    expect(result.approved).toHaveLength(0)
  })

  it("permits a change that has a recorded reason and migration link", () => {
    const result = evaluateCompatibility(
      [change],
      [
        {
          id: change.id,
          reason: "Money moved to the canonical minor-unit representation.",
          migrationUrl: "docs/api-migration.md#money",
          approvedOn: "2026-01-15",
        },
      ],
    )

    expect(result.breaking).toHaveLength(0)
    expect(result.approved).toHaveLength(1)
  })

  it("surfaces approvals that no longer match a change so the list stays honest", () => {
    const result = evaluateCompatibility([], [
      { id: "stale-id", reason: "r", migrationUrl: "u", approvedOn: "2026-01-01" },
    ])

    expect(result.staleApprovals.map((approval) => approval.id)).toEqual(["stale-id"])
  })
})

describe("identical documents", () => {
  it("reports no changes", () => {
    const document = doc({ ...requestBody({ type: "object", properties: { amount: {} } }), ...response({}) })
    expect(compareOpenApiDocuments(document, structuredClone(document))).toEqual([])
  })
})
