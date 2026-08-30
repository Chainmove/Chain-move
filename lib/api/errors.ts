import { randomUUID } from "node:crypto"
import { z } from "zod"

/**
 * Stable machine-readable error codes.
 *
 * These are part of the public API contract: clients branch on them, so a code
 * may be added but never renamed or repurposed without a version bump and a
 * documented migration window. See `docs/api-conventions.md`.
 */
export const API_ERROR_CODES = [
  "VALIDATION_FAILED",
  "MALFORMED_JSON",
  "UNSUPPORTED_MEDIA_TYPE",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "METHOD_NOT_ALLOWED",
  "CONFLICT",
  "UNPROCESSABLE",
  "RATE_LIMITED",
  "TRANSIENT_CONFLICT",
  "CONSENT_REQUIRED",
  "CONSENT_INVALID",
  "UPSTREAM_PROVIDER_ERROR",
  "UPSTREAM_UNAVAILABLE",
  "NOT_CONFIGURED",
  "UNSUPPORTED_API_VERSION",
  "INTERNAL_ERROR",
] as const

export type ApiErrorCode = (typeof API_ERROR_CODES)[number]

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  VALIDATION_FAILED: 400,
  MALFORMED_JSON: 400,
  UNSUPPORTED_MEDIA_TYPE: 415,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  METHOD_NOT_ALLOWED: 405,
  CONFLICT: 409,
  UNPROCESSABLE: 422,
  RATE_LIMITED: 429,
  TRANSIENT_CONFLICT: 503,
  CONSENT_REQUIRED: 409,
  CONSENT_INVALID: 409,
  UPSTREAM_PROVIDER_ERROR: 502,
  UPSTREAM_UNAVAILABLE: 503,
  NOT_CONFIGURED: 500,
  UNSUPPORTED_API_VERSION: 400,
  INTERNAL_ERROR: 500,
}

/**
 * Default client-safe messages. Handlers may override with their own message,
 * but the override must be authored copy — never an upstream or database
 * string, which is why `normalizeError` refuses to read `.message` off
 * unrecognized throwables.
 */
const DEFAULT_MESSAGE: Record<ApiErrorCode, string> = {
  VALIDATION_FAILED: "The request contains invalid fields.",
  MALFORMED_JSON: "Request body is not valid JSON.",
  UNSUPPORTED_MEDIA_TYPE: "Request content type is not supported.",
  UNAUTHENTICATED: "Unauthorized.",
  FORBIDDEN: "Access denied.",
  NOT_FOUND: "Resource not found.",
  METHOD_NOT_ALLOWED: "Method not allowed.",
  CONFLICT: "The request conflicts with the current state of the resource.",
  UNPROCESSABLE: "The request could not be processed.",
  RATE_LIMITED: "Too many requests. Please try again later.",
  TRANSIENT_CONFLICT: "Temporary conflict. Please retry the request.",
  CONSENT_REQUIRED: "Consent is required for this action.",
  CONSENT_INVALID: "Consent could not be applied to this action.",
  UPSTREAM_PROVIDER_ERROR: "An upstream provider rejected the request.",
  UPSTREAM_UNAVAILABLE: "An upstream provider is temporarily unavailable.",
  NOT_CONFIGURED: "This capability is not configured on the server.",
  UNSUPPORTED_API_VERSION: "The requested API version is not supported.",
  INTERNAL_ERROR: "Something went wrong. Please try again.",
}

export interface ApiFieldError {
  /** Dot/bracket path into the request payload, or `root` for whole-body errors. */
  path: string
  message: string
  /** Zod issue discriminator, e.g. `invalid_type`, `too_small`. */
  code?: string
}

export interface ApiErrorEnvelope {
  code: ApiErrorCode
  message: string
  correlationId: string
  fieldErrors?: ApiFieldError[]
  /** @deprecated Legacy alias for `fieldErrors`; removed in API v2. */
  issues?: Array<{ path: string; message: string }>
}

export const ApiFieldErrorSchema = z.object({
  path: z.string(),
  message: z.string(),
  code: z.string().optional(),
})

export const ApiErrorSchema = z.object({
  code: z.enum(API_ERROR_CODES),
  message: z.string(),
  correlationId: z.string(),
  fieldErrors: z.array(ApiFieldErrorSchema).optional(),
  issues: z.array(z.object({ path: z.string(), message: z.string() })).optional(),
})

export interface ApiErrorOptions {
  /** Client-safe message. Must be authored copy, not an upstream string. */
  message?: string
  fieldErrors?: ApiFieldError[]
  /** Underlying throwable, retained for server logs only. Never serialized. */
  cause?: unknown
  /** Extra server-log context. Never serialized. */
  logContext?: Record<string, unknown>
  /** Overrides the status implied by `code`. */
  status?: number
  headers?: Record<string, string>
}

/**
 * The only error type whose message is allowed to reach a client. Anything else
 * that escapes a handler is coerced to a generic `INTERNAL_ERROR`.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode
  readonly status: number
  readonly fieldErrors?: ApiFieldError[]
  readonly logContext?: Record<string, unknown>
  readonly headers?: Record<string, string>

  constructor(code: ApiErrorCode, options: ApiErrorOptions = {}) {
    super(options.message || DEFAULT_MESSAGE[code])
    this.name = "ApiError"
    this.code = code
    this.status = options.status ?? STATUS_BY_CODE[code]
    this.fieldErrors = options.fieldErrors
    this.logContext = options.logContext
    this.headers = options.headers
    if (options.cause !== undefined) {
      // Kept for logging; `toEnvelope` never reads it.
      ;(this as { cause?: unknown }).cause = options.cause
    }
  }

  toEnvelope(correlationId: string): ApiErrorEnvelope {
    const envelope: ApiErrorEnvelope = {
      code: this.code,
      message: this.message,
      correlationId,
    }

    if (this.fieldErrors?.length) {
      envelope.fieldErrors = this.fieldErrors
      envelope.issues = this.fieldErrors.map(({ path, message }) => ({ path, message }))
    }

    return envelope
  }

  static validation(fieldErrors: ApiFieldError[], message?: string) {
    return new ApiError("VALIDATION_FAILED", { message, fieldErrors })
  }

  static unauthenticated(message?: string) {
    return new ApiError("UNAUTHENTICATED", { message })
  }

  static forbidden(message?: string) {
    return new ApiError("FORBIDDEN", { message })
  }

  static notFound(message?: string) {
    return new ApiError("NOT_FOUND", { message })
  }

  static conflict(message?: string) {
    return new ApiError("CONFLICT", { message })
  }

  static unprocessable(message?: string, fieldErrors?: ApiFieldError[]) {
    return new ApiError("UNPROCESSABLE", { message, fieldErrors })
  }

  static internal(cause?: unknown, logContext?: Record<string, unknown>) {
    return new ApiError("INTERNAL_ERROR", { cause, logContext })
  }
}

export function isApiError(error: unknown): error is ApiError {
  return error instanceof ApiError
}

/** Flattens a `ZodError` into stable, client-safe field errors. */
export function fieldErrorsFromZod(error: z.ZodError, limit = 20): ApiFieldError[] {
  return error.issues.slice(0, limit).map((issue) => ({
    path: formatIssuePath(issue.path),
    message: issue.message,
    code: issue.code,
  }))
}

function formatIssuePath(path: Array<string | number>): string {
  if (!path.length) return "root"

  return path.reduce<string>((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`
    return acc ? `${acc}.${segment}` : segment
  }, "")
}

export function newCorrelationId(): string {
  return randomUUID()
}

/** Reuses an inbound trace id when the edge supplies one, so logs join up. */
export function resolveCorrelationId(request: Request): string {
  const header =
    request.headers.get("x-correlation-id") ||
    request.headers.get("x-request-id") ||
    request.headers.get("x-vercel-id")

  const trimmed = header?.trim()
  if (trimmed && trimmed.length <= 200 && /^[\w.:@/-]+$/.test(trimmed)) {
    return trimmed
  }

  return newCorrelationId()
}

/**
 * Provider/service errors opt into client-visible mapping by carrying an
 * `apiErrorCode`. Anything else — including errors that merely happen to have a
 * `statusCode` — is treated as internal so upstream text cannot leak.
 */
export interface ExposableServiceError {
  apiErrorCode: ApiErrorCode
  message: string
  statusCode?: number
  code?: string
}

function isExposableServiceError(error: unknown): error is ExposableServiceError {
  if (!error || typeof error !== "object") return false
  const candidate = error as { apiErrorCode?: unknown; message?: unknown }
  return (
    typeof candidate.message === "string" &&
    typeof candidate.apiErrorCode === "string" &&
    (API_ERROR_CODES as readonly string[]).includes(candidate.apiErrorCode)
  )
}

function isTransientMongoError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false

  const candidate = error as {
    code?: unknown
    codeName?: unknown
    errorLabels?: unknown
    message?: unknown
  }

  const labels = Array.isArray(candidate.errorLabels) ? candidate.errorLabels : []
  const message = typeof candidate.message === "string" ? candidate.message : ""

  return (
    candidate.code === 251 ||
    candidate.codeName === "NoSuchTransaction" ||
    labels.includes("TransientTransactionError") ||
    labels.includes("UnknownTransactionCommitResult") ||
    /does not match any in-progress transactions/i.test(message)
  )
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false
  return (error as { code?: unknown }).code === 11000
}

function isMongooseValidationError(error: unknown): error is { name: string; errors: Record<string, { message?: string; path?: string; kind?: string }> } {
  if (!error || typeof error !== "object") return false
  const candidate = error as { name?: unknown; errors?: unknown }
  return candidate.name === "ValidationError" && Boolean(candidate.errors) && typeof candidate.errors === "object"
}

/**
 * Coerces any throwable into an `ApiError`.
 *
 * The default branch deliberately discards the original message: raw
 * throwables carry database text, provider payloads, and stack context that
 * must not reach clients. The original is retained as `cause` for logging.
 */
export function normalizeError(error: unknown): ApiError {
  if (isApiError(error)) return error

  if (error instanceof z.ZodError) {
    return ApiError.validation(fieldErrorsFromZod(error))
  }

  if (isExposableServiceError(error)) {
    return new ApiError(error.apiErrorCode, {
      message: error.message,
      status: error.statusCode,
      cause: error,
      logContext: { providerCode: error.code },
    })
  }

  if (isTransientMongoError(error)) {
    return new ApiError("TRANSIENT_CONFLICT", { cause: error })
  }

  if (isDuplicateKeyError(error)) {
    // The raw error names the offending index and value; only the shape is safe.
    return new ApiError("CONFLICT", {
      message: "A record with these details already exists.",
      cause: error,
    })
  }

  if (isMongooseValidationError(error)) {
    const fieldErrors = Object.entries(error.errors)
      .slice(0, 20)
      .map(([path, detail]) => ({
        path,
        // Mongoose messages are schema-authored, but re-derive rather than echo
        // to avoid surfacing internal field names from casting failures.
        message: detail?.kind === "required" ? "This field is required." : "This field is invalid.",
      }))
    return ApiError.validation(fieldErrors)
  }

  return ApiError.internal(error)
}
