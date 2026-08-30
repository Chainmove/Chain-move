import { ApiError } from "./errors"

/**
 * ChainMove versions the API by date rather than by URL prefix, so a client can
 * pin behaviour without every route path churning. Clients select a version
 * with the `X-API-Version` request header; omitting it selects
 * `DEFAULT_API_VERSION`.
 */
export const API_VERSIONS = ["2026-01-01"] as const

export type ApiVersion = (typeof API_VERSIONS)[number]

export const CURRENT_API_VERSION: ApiVersion = "2026-01-01"

/**
 * The version applied when a request omits `X-API-Version`. It intentionally
 * lags `CURRENT_API_VERSION` only when a newer version ships breaking changes,
 * so unversioned clients keep working until their sunset date.
 */
export const DEFAULT_API_VERSION: ApiVersion = "2026-01-01"

export const API_VERSION_HEADER = "X-API-Version"

/**
 * Versions past their announced end of life. Requests pinned to one still
 * succeed until `sunset`, but carry `Deprecation`/`Sunset` headers.
 */
export const DEPRECATED_API_VERSIONS: Partial<Record<ApiVersion, DeprecationNotice>> = {}

export interface DeprecationNotice {
  /** Date the deprecation was announced (ISO 8601 date). */
  since: string
  /** Date after which the endpoint or version stops working (ISO 8601 date). */
  sunset: string
  /** Documentation describing the migration. */
  migrationUrl: string
  /** Replacement endpoint or version, when there is a direct successor. */
  replacedBy?: string
}

export function isApiVersion(value: string): value is ApiVersion {
  return (API_VERSIONS as readonly string[]).includes(value)
}

/**
 * Resolves the version for a request, rejecting unknown pins with a stable
 * error rather than silently serving current behaviour.
 */
export function resolveApiVersion(request: Request): ApiVersion {
  const requested = request.headers.get(API_VERSION_HEADER)?.trim()
  if (!requested) return DEFAULT_API_VERSION

  if (!isApiVersion(requested)) {
    throw new ApiError("UNSUPPORTED_API_VERSION", {
      message: `Unsupported ${API_VERSION_HEADER} "${sanitizeVersionEcho(requested)}". Supported versions: ${API_VERSIONS.join(", ")}.`,
      fieldErrors: [
        {
          path: API_VERSION_HEADER,
          message: `Expected one of: ${API_VERSIONS.join(", ")}.`,
          code: "unsupported_version",
        },
      ],
    })
  }

  return requested
}

/** Echoing an unvalidated header into a message invites header injection. */
function sanitizeVersionEcho(value: string): string {
  return value.replace(/[^\w.:-]/g, "").slice(0, 40)
}

function toHttpDate(isoDate: string): string {
  const date = new Date(isoDate)
  return Number.isNaN(date.getTime()) ? isoDate : date.toUTCString()
}

/**
 * Builds RFC 8594 / RFC 9745 deprecation headers. Applied by the route wrapper
 * whenever a contract or the requested version is deprecated.
 */
export function deprecationHeaders(notice: DeprecationNotice): Record<string, string> {
  const headers: Record<string, string> = {
    Deprecation: toHttpDate(notice.since),
    Sunset: toHttpDate(notice.sunset),
    Link: `<${notice.migrationUrl}>; rel="deprecation"; type="text/html"`,
  }

  const replacement = notice.replacedBy ? ` Use ${notice.replacedBy}.` : ""
  headers.Warning = `299 - "Deprecated since ${notice.since}; sunset ${notice.sunset}.${replacement}"`

  return headers
}

/** Deprecation applying to the request's pinned version, if any. */
export function versionDeprecation(version: ApiVersion): DeprecationNotice | undefined {
  return DEPRECATED_API_VERSIONS[version]
}
