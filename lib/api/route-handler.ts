import { NextResponse } from "next/server"
import { z } from "zod"

import { getAuthenticatedUser, withSessionRefresh } from "@/lib/auth/current-user"
import { logAuthorizationDenial } from "@/lib/authorization/audit"
import {
  authorize,
  isKycApproved,
  type AuthorizationAction,
  type AuthorizationResource,
} from "@/lib/authorization/policy"
import { normalizeUserRole, type AppUserRole } from "@/lib/api/route-guard"
import {
  ApiError,
  fieldErrorsFromZod,
  normalizeError,
  resolveCorrelationId,
  type ApiErrorEnvelope,
} from "@/lib/api/errors"
import { assertNoForbiddenFields, assertNoRawDocuments } from "@/lib/api/serialization"
import { logger } from "@/lib/observability/logger"
import { incrementMetric, recordLatency } from "@/lib/observability/metrics"
import {
  API_VERSION_HEADER,
  deprecationHeaders,
  resolveApiVersion,
  versionDeprecation,
  type ApiVersion,
  type DeprecationNotice,
} from "@/lib/api/versioning"

export const CORRELATION_ID_HEADER = "X-Correlation-Id"

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE"

type AuthMode = "public" | "authenticated" | "webhook"

type AuthenticatedUser = { _id: unknown; role?: unknown; [key: string]: unknown }

/**
 * Second argument Next.js passes to an App Router route handler.
 *
 * This mirrors the `RouteContext` shape in the generated `.next/types` route
 * contracts — required, with `params` always a promise — so `next build`
 * accepts every handler `defineRoute` produces. Widening it (for example back
 * to an optional argument) makes the generated contract check fail.
 */
export type NextRouteContext = {
  params: Promise<Record<string, string | string[] | undefined>>
}

export interface RouteContext<TParams, TQuery, TBody, TAuth extends AuthMode> {
  request: Request
  params: TParams
  query: TQuery
  body: TBody
  /** Authenticated user, or `null` for `public`/`webhook` routes. */
  user: TAuth extends "authenticated" ? AuthenticatedUser : AuthenticatedUser | null
  /** Resource resolved for the authorization check, when the route declares one. */
  resource: AuthorizationResource | null
  correlationId: string
  version: ApiVersion
  /** Response headers to merge into the success response. */
  setHeader: (name: string, value: string) => void
  /** Overrides the success status for this request (e.g. 200 vs 201). */
  setStatus: (status: number) => void
}

export interface RouteDefinition<
  TParamsSchema extends z.ZodTypeAny,
  TQuerySchema extends z.ZodTypeAny,
  TBodySchema extends z.ZodTypeAny,
  TResponseSchema extends z.ZodTypeAny,
  TAuth extends AuthMode,
> {
  /** Matches the `operationId` in the generated OpenAPI document. */
  operationId: string
  method: HttpMethod
  auth: TAuth
  /** Role allow-list applied after authentication. */
  roles?: readonly AppUserRole[]
  /** Policy action; when set, the shared authorization engine decides access. */
  action?: AuthorizationAction
  /**
   * Resolves the resource the policy engine reasons about. Runs after
   * authentication and after params/query parsing so it can load by id.
   */
  resource?: (input: {
    user: AuthenticatedUser
    params: z.infer<TParamsSchema>
    query: z.infer<TQuerySchema>
    request: Request
  }) => Promise<AuthorizationResource> | AuthorizationResource
  params?: TParamsSchema
  query?: TQuerySchema
  body?: TBodySchema
  response: TResponseSchema
  successStatus?: number
  deprecation?: DeprecationNotice
  handler: (
    context: RouteContext<z.infer<TParamsSchema>, z.infer<TQuerySchema>, z.infer<TBodySchema>, TAuth>,
  ) => Promise<unknown>
}

const METHODS_WITH_BODY = new Set<HttpMethod>(["POST", "PATCH", "PUT"])

/**
 * Builds a Next.js route handler from a contract.
 *
 * Every request follows the same pipeline — resolve version, validate path
 * params, authenticate, authorize, validate query and body, run the handler,
 * then validate and serialize the response. Anything thrown along the way is
 * funnelled through `normalizeError`, so clients only ever see the standard
 * envelope and never an upstream or database message.
 */
export function defineRoute<
  TParamsSchema extends z.ZodTypeAny = z.ZodUndefined,
  TQuerySchema extends z.ZodTypeAny = z.ZodUndefined,
  TBodySchema extends z.ZodTypeAny = z.ZodUndefined,
  TResponseSchema extends z.ZodTypeAny = z.ZodTypeAny,
  TAuth extends AuthMode = "authenticated",
>(definition: RouteDefinition<TParamsSchema, TQuerySchema, TBodySchema, TResponseSchema, TAuth>) {
  return async function routeHandler(request: Request, nextContext: NextRouteContext): Promise<Response> {
    const correlationId = resolveCorrelationId(request)
    const startedAt = performance.now()
    const extraHeaders: Record<string, string> = {}
    let successStatus = definition.successStatus ?? (definition.method === "POST" ? 201 : 200)
    let version: ApiVersion | undefined

    try {
      version = resolveApiVersion(request)

      const params = await parseParams(definition, nextContext)
      const auth = await authenticate(definition, request)
      const query = parseQuery(definition, request)
      const resource = await authorizeRoute(definition, auth.user, params, query, request)
      const body = await parseBody(definition, request)

      const payload = await definition.handler({
        request,
        params,
        query,
        body,
        user: auth.user as never,
        resource,
        correlationId,
        version,
        setHeader: (name, value) => {
          extraHeaders[name] = value
        },
        setStatus: (status) => {
          successStatus = status
        },
      })

      const serialized = serializeResponse(definition, payload, correlationId)

      // A 204 must carry no body at all, so it cannot go through `json()`.
      const response =
        payload instanceof NoContent
          ? new NextResponse(null, { status: 204 })
          : NextResponse.json(serialized, { status: successStatus })

      applyHeaders(response, {
        ...extraHeaders,
        ...responseHeaders(definition, version, request),
        [CORRELATION_ID_HEADER]: correlationId,
      })

      if (auth.shouldRefreshSession && auth.user) {
        logRequest(definition, request, correlationId, successStatus, startedAt)
        return withSessionRefresh(response, auth.user)
      }

      logRequest(definition, request, correlationId, successStatus, startedAt)
      return response
    } catch (error) {
      const response = errorResponse(error, {
        correlationId,
        operationId: definition.operationId,
        method: definition.method,
        version,
        headers: definition.deprecation ? deprecationHeaders(definition.deprecation) : {},
      })
      logRequest(definition, request, correlationId, response.status, startedAt)
      return response
    }
  }
}

function logRequest(
  definition: { operationId: string; method: HttpMethod },
  request: Request,
  correlationId: string,
  status: number,
  startedAt: number,
) {
  const durationMs = Math.round((performance.now() - startedAt) * 100) / 100
  const outcome = status >= 500 ? "5xx" : status >= 400 ? "4xx" : "success"
  incrementMetric("http.requests", outcome)
  if (status >= 500) incrementMetric("http.errors", "5xx")
  recordLatency("http.duration", durationMs)
  logger.info({
    event: "http.request.completed",
    correlationId,
    operationId: definition.operationId,
    method: definition.method,
    route: new URL(request.url).pathname,
    status,
    durationMs,
  })
}

/** Sentinel a handler can return to emit `204 No Content`. */
export class NoContent {}

/* -------------------------------------------------------------------------- */
/* Pipeline stages                                                             */
/* -------------------------------------------------------------------------- */

async function parseParams(
  definition: { params?: z.ZodTypeAny },
  // Optional here, not in the exported handler signature: direct callers such
  // as tests may omit the context entirely, while Next.js always supplies it.
  nextContext: NextRouteContext | undefined,
) {
  if (!definition.params) return undefined

  const raw = (await nextContext?.params) ?? {}
  const result = definition.params.safeParse(raw)

  if (!result.success) {
    // A malformed path segment is indistinguishable from a missing resource to
    // an unauthenticated caller, so report it as not-found rather than
    // confirming the route's id format.
    throw ApiError.notFound()
  }

  return result.data
}

function parseQuery(definition: { query?: z.ZodTypeAny }, request: Request) {
  if (!definition.query) return undefined

  const url = new URL(request.url)
  const params: Record<string, string | string[]> = {}

  url.searchParams.forEach((value, key) => {
    const current = params[key]
    if (typeof current === "undefined") {
      params[key] = value
      return
    }
    params[key] = Array.isArray(current) ? [...current, value] : [current, value]
  })

  const result = definition.query.safeParse(params)
  if (!result.success) {
    throw ApiError.validation(fieldErrorsFromZod(result.error), "Invalid query parameters.")
  }

  return result.data
}

async function parseBody(definition: { method: HttpMethod; body?: z.ZodTypeAny }, request: Request) {
  if (!definition.body) return undefined

  if (!METHODS_WITH_BODY.has(definition.method)) {
    throw ApiError.internal(new Error(`Route declares a body schema for ${definition.method}.`))
  }

  const contentType = request.headers.get("content-type") || ""
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    throw new ApiError("UNSUPPORTED_MEDIA_TYPE", {
      message: "Request body must be sent as application/json.",
    })
  }

  let raw: unknown
  try {
    const text = await request.text()
    raw = text.trim() === "" ? undefined : JSON.parse(text)
  } catch {
    throw new ApiError("MALFORMED_JSON")
  }

  const result = definition.body.safeParse(raw)
  if (!result.success) {
    throw ApiError.validation(fieldErrorsFromZod(result.error), "Invalid request body.")
  }

  return result.data
}

async function authenticate(
  definition: { auth: AuthMode },
  request: Request,
): Promise<{ user: AuthenticatedUser | null; shouldRefreshSession: boolean }> {
  if (definition.auth !== "authenticated") {
    return { user: null, shouldRefreshSession: false }
  }

  const context = await getAuthenticatedUser(request)
  if (!context.user) {
    throw ApiError.unauthenticated()
  }

  return {
    user: context.user as unknown as AuthenticatedUser,
    shouldRefreshSession: context.shouldRefreshSession,
  }
}

async function authorizeRoute<
  TParamsSchema extends z.ZodTypeAny,
  TQuerySchema extends z.ZodTypeAny,
>(
  definition: Pick<
    RouteDefinition<TParamsSchema, TQuerySchema, z.ZodTypeAny, z.ZodTypeAny, AuthMode>,
    "auth" | "roles" | "action" | "resource"
  >,
  user: AuthenticatedUser | null,
  params: z.infer<TParamsSchema>,
  query: z.infer<TQuerySchema>,
  request: Request,
): Promise<AuthorizationResource | null> {
  if (definition.auth !== "authenticated" || !user) return null

  const role = normalizeUserRole(user.role)

  if (definition.roles && (!role || !definition.roles.includes(role))) {
    throw ApiError.forbidden()
  }

  if (!definition.action) return null

  const resource = definition.resource
    ? await definition.resource({ user, params, query, request })
    : ({ type: "account" } as AuthorizationResource)

  const decision = authorize(
    {
      principal: {
        id: String((user as { _id: { toString(): string } })._id),
        role,
        kycApproved: isKycApproved(toPlainUser(user)),
        privileged: role === "admin",
      },
    },
    definition.action,
    resource,
  )

  if (!decision.allowed) {
    await logAuthorizationDenial({
      actor: user,
      action: definition.action,
      resourceType: resource.type,
      decision,
    })

    // `conceal` means the caller must not learn the resource exists, so a
    // denied ownership check reports 404 rather than 403.
    throw decision.conceal ? ApiError.notFound() : ApiError.forbidden()
  }

  return resource
}

/**
 * The policy engine inspects plain KYC fields, which a hydrated Mongoose
 * document only exposes through `toObject()`.
 */
function toPlainUser(user: AuthenticatedUser): unknown {
  const candidate = user as { toObject?: unknown }
  return typeof candidate.toObject === "function"
    ? (candidate.toObject as () => unknown)()
    : user
}

/**
 * Validates the handler payload against the contract's response schema.
 *
 * Zod object parsing strips undeclared keys, which is the primary guarantee
 * that internal fields never reach a client. The assertions afterwards catch
 * the remaining cases: a schema that explicitly declares a denied field, and a
 * raw Mongoose document smuggled through a permissive schema.
 */
function serializeResponse(
  definition: { response: z.ZodTypeAny; operationId: string },
  payload: unknown,
  correlationId: string,
) {
  if (payload instanceof NoContent) return null

  const result = definition.response.safeParse(payload)

  if (!result.success) {
    // The handler produced something the contract does not describe. Surfacing
    // the mismatch would leak internals, so clients get a generic failure while
    // the mismatch is logged for the operator.
    throw ApiError.internal(result.error, {
      reason: "response_contract_violation",
      operationId: definition.operationId,
      correlationId,
      issues: fieldErrorsFromZod(result.error, 10),
    })
  }

  assertNoRawDocuments(result.data)
  assertNoForbiddenFields(result.data)

  return result.data
}

function responseHeaders(
  definition: { deprecation?: DeprecationNotice; query?: z.ZodTypeAny },
  version: ApiVersion,
  request: Request,
): Record<string, string> {
  const headers: Record<string, string> = { [API_VERSION_HEADER]: version }

  const notice = definition.deprecation ?? versionDeprecation(version)
  if (notice) Object.assign(headers, deprecationHeaders(notice))

  // Surfaced separately from endpoint deprecation so a client using a legacy
  // parameter on a supported endpoint still gets told. Read from the raw URL
  // because the alias is normalized away before the handler sees it.
  if (definition.query && new URL(request.url).searchParams.has("limit")) {
    headers.Warning = `299 - "The 'limit' query parameter is deprecated; use 'pageSize'."`
  }

  return headers
}

function applyHeaders(response: NextResponse, headers: Record<string, string>) {
  for (const [name, value] of Object.entries(headers)) {
    response.headers.set(name, value)
  }
}

/* -------------------------------------------------------------------------- */
/* Error responses                                                             */
/* -------------------------------------------------------------------------- */

export function errorResponse(
  error: unknown,
  context: {
    correlationId: string
    operationId?: string
    method?: string
    version?: ApiVersion
    headers?: Record<string, string>
  },
): NextResponse {
  const apiError = normalizeError(error)
  const envelope: ApiErrorEnvelope = apiError.toEnvelope(context.correlationId)

  logApiError(apiError, context)

  const response = NextResponse.json(envelope, { status: apiError.status })

  applyHeaders(response, {
    ...(context.headers || {}),
    ...(apiError.headers || {}),
    ...(context.version ? { [API_VERSION_HEADER]: context.version } : {}),
    [CORRELATION_ID_HEADER]: context.correlationId,
  })

  return response
}

function logApiError(
  error: ApiError,
  context: { correlationId: string; operationId?: string; method?: string },
) {
  const detail = {
    correlationId: context.correlationId,
    operationId: context.operationId,
    method: context.method,
    code: error.code,
    status: error.status,
    ...(error.logContext || {}),
  }

  // 5xx means the server is at fault and an operator needs the stack; 4xx is
  // routine client behaviour and stays at debug volume.
  if (error.status >= 500) {
    logger.error({ event: "api.error", ...detail, error: (error as { cause?: unknown }).cause ?? error })
    return
  }

  if (process.env.NODE_ENV === "development") {
    logger.debug({ event: "api.client_error", ...detail })
  }
}
