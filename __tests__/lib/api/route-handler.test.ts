// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest"
import { z } from "zod"

import type { NextRouteContext } from "@/lib/api/route-handler"

const getAuthenticatedUser = vi.fn()
const withSessionRefresh = vi.fn(async (response: unknown, _user: unknown) => response)
const logAuthorizationDenial = vi.fn(async (_input: unknown) => undefined)

vi.mock("@/lib/auth/current-user", () => ({
  getAuthenticatedUser: (request: Request) => getAuthenticatedUser(request),
  withSessionRefresh: (response: unknown, user: unknown) => withSessionRefresh(response, user),
}))

vi.mock("@/lib/authorization/audit", () => ({
  logAuthorizationDenial: (input: unknown) => logAuthorizationDenial(input),
}))

const { defineRoute } = await import("@/lib/api/route-handler")
const { ApiError } = await import("@/lib/api/errors")
const { DEPRECATED_API_VERSIONS } = await import("@/lib/api/versioning")

/**
 * Next.js always passes a route context; routes without dynamic segments
 * simply receive empty params. Tests mirror that call shape.
 */
const noParams: NextRouteContext = { params: Promise.resolve({}) }

const INVESTOR_ID = "665f1a2b3c4d5e6f70819203"
const OTHER_ID = "665f1a2b3c4d5e6f70819999"

function authenticateAs(user: Record<string, unknown> | null, shouldRefreshSession = false) {
  getAuthenticatedUser.mockResolvedValue({ user, shouldRefreshSession })
}

function investor(overrides: Record<string, unknown> = {}) {
  return { _id: INVESTOR_ID, role: "investor", kycStatus: "approved_stage2", ...overrides }
}

function jsonRequest(body: string | object, init: RequestInit = {}) {
  return new Request("https://chainmove.test/api/thing", {
    method: "POST",
    headers: { "content-type": "application/json", ...(init.headers || {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
    ...init,
  })
}

const OkResponse = z.object({ success: z.literal(true), value: z.string() })

beforeEach(() => {
  vi.clearAllMocks()
  authenticateAs(investor())
})

describe("defineRoute — request validation", () => {
  const route = defineRoute({
    operationId: "testCreate",
    method: "POST",
    auth: "authenticated",
    body: z.object({ amount: z.number().positive() }).strict(),
    response: OkResponse,
    handler: async () => ({ success: true as const, value: "ok" }),
  })

  it("rejects malformed JSON with a stable code rather than a parser message", async () => {
    const response = await route(jsonRequest("{ not json"), noParams)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.code).toBe("MALFORMED_JSON")
    expect(payload.message).toBe("Request body is not valid JSON.")
    // A parser message would disclose the body content back to the caller.
    expect(payload.message).not.toContain("not json")
  })

  it("returns field-level errors for an invalid body", async () => {
    const response = await route(jsonRequest({ amount: -5 }), noParams)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.code).toBe("VALIDATION_FAILED")
    expect(payload.fieldErrors).toEqual([
      expect.objectContaining({ path: "amount", code: "too_small" }),
    ])
  })

  it("reports unknown body fields instead of silently dropping them", async () => {
    const response = await route(jsonRequest({ amount: 5, exchangeRate: 1500 }), noParams)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.fieldErrors.some((issue: { code: string }) => issue.code === "unrecognized_keys")).toBe(true)
  })

  it("rejects a non-JSON content type", async () => {
    const response = await route(
      jsonRequest("amount=5", { headers: { "content-type": "application/x-www-form-urlencoded" } }),
      noParams,
    )

    expect(response.status).toBe(415)
    expect((await response.json()).code).toBe("UNSUPPORTED_MEDIA_TYPE")
  })

  it("rejects invalid query values with the offending parameter named", async () => {
    const queryRoute = defineRoute({
      operationId: "testList",
      method: "GET",
      auth: "authenticated",
      query: z.object({ page: z.coerce.number().int().min(1).default(1) }),
      response: OkResponse,
      handler: async () => ({ success: true as const, value: "ok" }),
    })

    const response = await queryRoute(new Request("https://chainmove.test/api/thing?page=abc"), noParams)
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.code).toBe("VALIDATION_FAILED")
    expect(payload.message).toBe("Invalid query parameters.")
    expect(payload.fieldErrors[0].path).toBe("page")
  })
})

describe("defineRoute — authentication and authorization", () => {
  const ownedRoute = defineRoute({
    operationId: "testOwned",
    method: "GET",
    auth: "authenticated",
    action: "wallet:read",
    resource: ({ user }) => ({ type: "wallet", ownerId: String(user._id) }),
    response: OkResponse,
    handler: async () => ({ success: true as const, value: "ok" }),
  })

  it("returns 401 when unauthenticated", async () => {
    authenticateAs(null)

    const response = await ownedRoute(new Request("https://chainmove.test/api/thing"), noParams)

    expect(response.status).toBe(401)
    expect((await response.json()).code).toBe("UNAUTHENTICATED")
  })

  it("returns 403 when the role is not permitted", async () => {
    authenticateAs(investor({ role: "driver" }))

    const adminRoute = defineRoute({
      operationId: "testAdmin",
      method: "GET",
      auth: "authenticated",
      roles: ["admin"],
      response: OkResponse,
      handler: async () => ({ success: true as const, value: "ok" }),
    })

    const response = await adminRoute(new Request("https://chainmove.test/api/thing"), noParams)

    expect(response.status).toBe(403)
    expect((await response.json()).code).toBe("FORBIDDEN")
  })

  it("reports another user's resource as 404 so existence is not enumerable", async () => {
    const foreignRoute = defineRoute({
      operationId: "testForeign",
      method: "GET",
      auth: "authenticated",
      action: "wallet:read",
      resource: () => ({ type: "wallet", ownerId: OTHER_ID }),
      response: OkResponse,
      handler: async () => ({ success: true as const, value: "ok" }),
    })

    const response = await foreignRoute(new Request("https://chainmove.test/api/thing"), noParams)
    const payload = await response.json()

    expect(response.status).toBe(404)
    expect(payload.code).toBe("NOT_FOUND")
    // A 403 here would confirm the resource exists and belongs to someone else.
    expect(payload.message).toBe("Resource not found.")
    expect(logAuthorizationDenial).toHaveBeenCalledTimes(1)
  })

  it("reports a missing resource as 404 without reaching the handler", async () => {
    const handler = vi.fn()
    const missingRoute = defineRoute({
      operationId: "testMissing",
      method: "GET",
      auth: "authenticated",
      action: "wallet:read",
      resource: ({ user }) => ({ type: "wallet", ownerId: String(user._id), exists: false }),
      response: OkResponse,
      handler,
    })

    const response = await missingRoute(new Request("https://chainmove.test/api/thing"), noParams)

    expect(response.status).toBe(404)
    expect(handler).not.toHaveBeenCalled()
  })

  it("treats an unparsable path parameter as not-found", async () => {
    const paramRoute = defineRoute({
      operationId: "testParam",
      method: "GET",
      auth: "authenticated",
      params: z.object({ poolId: z.string().regex(/^[a-f\d]{24}$/i) }),
      response: OkResponse,
      handler: async () => ({ success: true as const, value: "ok" }),
    })

    const response = await paramRoute(new Request("https://chainmove.test/api/thing"), {
      params: Promise.resolve({ poolId: "not-an-id" }),
    })

    expect(response.status).toBe(404)
  })

  it("passes the authenticated user and parsed input to the handler", async () => {
    const handler = vi.fn(async () => ({ success: true as const, value: "ok" }))

    const route = defineRoute({
      operationId: "testContext",
      method: "POST",
      auth: "authenticated",
      params: z.object({ poolId: z.string() }),
      query: z.object({ dryRun: z.coerce.boolean().default(false) }),
      body: z.object({ amount: z.number() }).strict(),
      response: OkResponse,
      handler,
    })

    await route(
      new Request("https://chainmove.test/api/thing?dryRun=true", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: 10 }),
      }),
      { params: Promise.resolve({ poolId: "pool-1" }) },
    )

    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        params: { poolId: "pool-1" },
        query: { dryRun: true },
        body: { amount: 10 },
        user: expect.objectContaining({ _id: INVESTOR_ID }),
      }),
    )
  })
})

describe("defineRoute — error mapping", () => {
  function routeThrowing(error: unknown) {
    return defineRoute({
      operationId: "testThrow",
      method: "GET",
      auth: "authenticated",
      response: OkResponse,
      handler: async () => {
        throw error
      },
    })
  }

  it("never leaks an unexpected error message", async () => {
    const route = routeThrowing(new Error("connect ECONNREFUSED mongodb://user:pa55w0rd@10.0.0.5:27017"))

    const response = await route(new Request("https://chainmove.test/api/thing"), noParams)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.code).toBe("INTERNAL_ERROR")
    expect(payload.message).toBe("Something went wrong. Please try again.")
    expect(JSON.stringify(payload)).not.toContain("pa55w0rd")
    expect(JSON.stringify(payload)).not.toContain("mongodb")
  })

  it("never leaks a stack trace", async () => {
    const error = new Error("boom")
    error.stack = "Error: boom\n    at /srv/chainmove/lib/services/investments.service.ts:142:9"

    const response = await routeThrowing(error)(new Request("https://chainmove.test/api/thing"), noParams)
    const body = JSON.stringify(await response.json())

    expect(body).not.toContain("at /srv")
    expect(body).not.toContain("investments.service")
    expect(body).not.toContain("stack")
  })

  it("maps a transient transaction conflict to a retryable 503", async () => {
    const route = routeThrowing(
      Object.assign(new Error("Transaction aborted"), { errorLabels: ["TransientTransactionError"] }),
    )

    const response = await route(new Request("https://chainmove.test/api/thing"), noParams)

    expect(response.status).toBe(503)
    expect((await response.json()).code).toBe("TRANSIENT_CONFLICT")
  })

  it("maps a duplicate key error to 409 without naming the index", async () => {
    const route = routeThrowing(
      Object.assign(new Error("E11000 duplicate key error collection: users index: email_1"), { code: 11000 }),
    )

    const response = await route(new Request("https://chainmove.test/api/thing"), noParams)
    const payload = await response.json()

    expect(response.status).toBe(409)
    expect(payload.message).not.toContain("email_1")
  })

  it("forwards an explicitly exposable provider error", async () => {
    const route = routeThrowing(
      new ApiError("UPSTREAM_PROVIDER_ERROR", {
        message: "The payment provider could not start this transaction.",
      }),
    )

    const response = await route(new Request("https://chainmove.test/api/thing"), noParams)
    const payload = await response.json()

    expect(response.status).toBe(502)
    expect(payload.code).toBe("UPSTREAM_PROVIDER_ERROR")
    expect(payload.message).toBe("The payment provider could not start this transaction.")
  })

  it("attaches a correlation id to every error", async () => {
    const route = routeThrowing(new Error("boom"))

    const response = await route(new Request("https://chainmove.test/api/thing"), noParams)
    const payload = await response.json()

    expect(payload.correlationId).toMatch(/^[0-9a-f-]{36}$/)
    expect(response.headers.get("X-Correlation-Id")).toBe(payload.correlationId)
  })

  it("reuses an inbound correlation id so logs join up", async () => {
    const route = routeThrowing(new Error("boom"))

    const response = await route(
      new Request("https://chainmove.test/api/thing", { headers: { "x-correlation-id": "edge-abc-123" } }),
      noParams,
    )

    expect((await response.json()).correlationId).toBe("edge-abc-123")
  })
})

describe("defineRoute — response serialization", () => {
  it("strips fields the contract does not declare", async () => {
    const route = defineRoute({
      operationId: "testStrip",
      method: "GET",
      auth: "authenticated",
      response: OkResponse,
      handler: async () =>
        ({
          success: true as const,
          value: "ok",
          passwordHash: "$2b$10$leaked",
          internalNote: "do not ship",
        }) as never,
    })

    const response = await route(new Request("https://chainmove.test/api/thing"), noParams)
    const payload = await response.json()

    expect(payload).toEqual({ success: true, value: "ok" })
    expect(JSON.stringify(payload)).not.toContain("leaked")
  })

  it("fails closed when the handler violates its own contract", async () => {
    const route = defineRoute({
      operationId: "testViolation",
      method: "GET",
      auth: "authenticated",
      response: OkResponse,
      handler: async () => ({ success: true as const }) as never,
    })

    const response = await route(new Request("https://chainmove.test/api/thing"), noParams)
    const payload = await response.json()

    expect(response.status).toBe(500)
    expect(payload.code).toBe("INTERNAL_ERROR")
    // The contract mismatch is an operator concern, not a client one.
    expect(payload.fieldErrors).toBeUndefined()
  })

  it("refuses to serialize a raw Mongoose document", async () => {
    const route = defineRoute({
      operationId: "testRawDocument",
      method: "GET",
      auth: "authenticated",
      response: z.object({ success: z.literal(true), record: z.any() }),
      handler: async () => ({
        success: true as const,
        record: { $__: {}, toObject: () => ({}), _doc: { secretField: 1 } },
      }),
    })

    const response = await route(new Request("https://chainmove.test/api/thing"), noParams)

    expect(response.status).toBe(500)
    expect((await response.json()).code).toBe("INTERNAL_ERROR")
  })

  it("uses the declared success status and refreshes a stale session", async () => {
    authenticateAs(investor(), true)

    const route = defineRoute({
      operationId: "testCreated",
      method: "POST",
      auth: "authenticated",
      response: OkResponse,
      successStatus: 201,
      handler: async () => ({ success: true as const, value: "ok" }),
    })

    const response = await route(jsonRequest({}), noParams)

    expect(response.status).toBe(201)
    expect(withSessionRefresh).toHaveBeenCalledTimes(1)
  })
})

describe("defineRoute — versioning and deprecation", () => {
  const route = defineRoute({
    operationId: "testVersion",
    method: "GET",
    auth: "authenticated",
    response: OkResponse,
    successStatus: 200,
    handler: async () => ({ success: true as const, value: "ok" }),
  })

  it("reports the serving version on success", async () => {
    const response = await route(new Request("https://chainmove.test/api/thing"), noParams)

    expect(response.status).toBe(200)
    expect(response.headers.get("X-API-Version")).toBe("2026-01-01")
  })

  it("honours a supported pinned version", async () => {
    const response = await route(
      new Request("https://chainmove.test/api/thing", { headers: { "X-API-Version": "2026-01-01" } }),
      noParams,
    )

    expect(response.status).toBe(200)
  })

  it("rejects an unsupported version with a stable code", async () => {
    const response = await route(
      new Request("https://chainmove.test/api/thing", { headers: { "X-API-Version": "1999-01-01" } }),
      noParams,
    )
    const payload = await response.json()

    expect(response.status).toBe(400)
    expect(payload.code).toBe("UNSUPPORTED_API_VERSION")
    expect(payload.fieldErrors[0].path).toBe("X-API-Version")
  })

  it("emits sunset headers for a deprecated endpoint", async () => {
    const deprecated = defineRoute({
      operationId: "testDeprecated",
      method: "GET",
      auth: "authenticated",
      response: OkResponse,
      successStatus: 200,
      deprecation: {
        since: "2026-02-01",
        sunset: "2026-08-01",
        migrationUrl: "https://chainmove.test/docs/api-migration",
        replacedBy: "GET /api/wallet/summary",
      },
      handler: async () => ({ success: true as const, value: "ok" }),
    })

    const response = await deprecated(new Request("https://chainmove.test/api/thing"), noParams)

    expect(response.headers.get("Deprecation")).toContain("2026")
    expect(response.headers.get("Sunset")).toContain("2026")
    expect(response.headers.get("Link")).toContain('rel="deprecation"')
    expect(response.headers.get("Warning")).toContain("GET /api/wallet/summary")
  })

  it("emits sunset headers when the request pins a deprecated API version", async () => {
    // No supported version is deprecated today, so the entry is injected to
    // exercise the wiring a future deprecation will depend on.
    DEPRECATED_API_VERSIONS["2026-01-01"] = {
      since: "2026-03-01",
      sunset: "2026-09-01",
      migrationUrl: "https://chainmove.test/docs/api-migration",
      replacedBy: "2026-07-01",
    }

    try {
      const response = await route(
        new Request("https://chainmove.test/api/thing", { headers: { "X-API-Version": "2026-01-01" } }),
        noParams,
      )

      // A deprecated version still works until its sunset date.
      expect(response.status).toBe(200)
      expect(response.headers.get("Deprecation")).toContain("2026")
      expect(response.headers.get("Sunset")).toContain("2026")
      expect(response.headers.get("Warning")).toContain("2026-07-01")
    } finally {
      delete DEPRECATED_API_VERSIONS["2026-01-01"]
    }
  })

  it("lets an endpoint deprecation take precedence over a version deprecation", async () => {
    DEPRECATED_API_VERSIONS["2026-01-01"] = {
      since: "2026-03-01",
      sunset: "2026-09-01",
      migrationUrl: "https://chainmove.test/docs/version",
    }

    const deprecatedEndpoint = defineRoute({
      operationId: "testBothDeprecations",
      method: "GET",
      auth: "authenticated",
      response: OkResponse,
      successStatus: 200,
      deprecation: {
        since: "2026-02-01",
        sunset: "2026-08-01",
        migrationUrl: "https://chainmove.test/docs/endpoint",
        replacedBy: "GET /api/wallet/summary",
      },
      handler: async () => ({ success: true as const, value: "ok" }),
    })

    try {
      const response = await deprecatedEndpoint(new Request("https://chainmove.test/api/thing"), noParams)

      // The endpoint notice is the more specific signal for this caller.
      expect(response.headers.get("Link")).toContain("docs/endpoint")
      expect(response.headers.get("Warning")).toContain("GET /api/wallet/summary")
    } finally {
      delete DEPRECATED_API_VERSIONS["2026-01-01"]
    }
  })

  it("sends no deprecation headers on a current version", async () => {
    const response = await route(new Request("https://chainmove.test/api/thing"), noParams)

    expect(response.headers.get("Deprecation")).toBeNull()
    expect(response.headers.get("Sunset")).toBeNull()
  })

  it("warns when a request uses the deprecated limit alias", async () => {
    const paginated = defineRoute({
      operationId: "testPaginated",
      method: "GET",
      auth: "authenticated",
      query: z.object({ pageSize: z.coerce.number().int().default(20) }),
      response: OkResponse,
      successStatus: 200,
      handler: async () => ({ success: true as const, value: "ok" }),
    })

    const response = await paginated(new Request("https://chainmove.test/api/thing?limit=10"), noParams)

    expect(response.headers.get("Warning")).toContain("'limit' query parameter is deprecated")
  })
})
