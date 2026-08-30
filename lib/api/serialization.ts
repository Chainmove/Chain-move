import { z } from "zod"

/**
 * Field names that must never appear in an API response or in generated
 * documentation. The guard below walks serialized payloads and throws when one
 * of these surfaces, which turns a silent leak into a failing test.
 *
 * Matching is case-insensitive on the normalized key (non-alphanumerics
 * stripped) so `password_hash`, `passwordHash`, and `PasswordHash` all match.
 */
export const FORBIDDEN_RESPONSE_FIELDS = [
  "password",
  "passwordhash",
  "passwordsalt",
  "salt",
  "secret",
  "secretkey",
  "privatekey",
  "seedphrase",
  "mnemonic",
  "apikey",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "jwtsecret",
  "signingkey",
  "encryptionkey",
  "webhooksecret",
  "paystacksecretkey",
  "authorizationcode",
  "cardnumber",
  "cvv",
  "pin",
  "otp",
  "bvn",
  "nin",
  "ssn",
  "__v",
] as const

const FORBIDDEN_SET = new Set<string>(FORBIDDEN_RESPONSE_FIELDS)

/**
 * Keys matched verbatim rather than by normalization. `__v` would otherwise
 * normalize to `v`, and adding `v` to the general set would reject legitimate
 * single-letter fields.
 */
const FORBIDDEN_EXACT = new Set<string>(["__v"])

function normalizeKey(key: string): string {
  return key.replace(/[^a-z0-9]/gi, "").toLowerCase()
}

export function isForbiddenResponseField(key: string): boolean {
  return FORBIDDEN_EXACT.has(key) || FORBIDDEN_SET.has(normalizeKey(key))
}

export class ResponseRedactionError extends Error {
  readonly path: string

  constructor(path: string) {
    super(`Response payload contains forbidden field "${path}".`)
    this.name = "ResponseRedactionError"
    this.path = path
  }
}

/**
 * Throws if a serialized payload exposes a denied field. Called by the route
 * wrapper on every response and by the OpenAPI generator on every schema, so a
 * leak fails fast in CI rather than shipping.
 */
export function assertNoForbiddenFields(value: unknown, path = "root", seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object") return

  if (seen.has(value as object)) return
  seen.add(value as object)

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoForbiddenFields(entry, `${path}[${index}]`, seen))
    return
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenResponseField(key)) {
      throw new ResponseRedactionError(path === "root" ? key : `${path}.${key}`)
    }
    assertNoForbiddenFields(entry, path === "root" ? key : `${path}.${key}`, seen)
  }
}

/** Removes denied fields instead of throwing. For logs and audit metadata. */
export function redact<T>(value: T): T {
  if (value === null || typeof value !== "object") return value
  if (Array.isArray(value)) return value.map((entry) => redact(entry)) as unknown as T

  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (isForbiddenResponseField(key)) {
      output[key] = "[redacted]"
      continue
    }
    output[key] = redact(entry)
  }

  return output as unknown as T
}

/**
 * True when a value is a Mongoose document or an ObjectId rather than a plain
 * serializable object. Handlers must map documents through an explicit
 * serializer; returning one directly leaks every schema field including ones
 * added later.
 */
function isMongooseLike(value: unknown): boolean {
  if (!value || typeof value !== "object") return false
  const candidate = value as Record<string, unknown>
  return (
    typeof candidate.$__ === "object" ||
    typeof candidate.toObject === "function" ||
    (candidate.constructor as { name?: string } | undefined)?.name === "ObjectId" ||
    typeof (candidate as { _bsontype?: unknown })._bsontype === "string"
  )
}

export class RawDocumentError extends Error {
  constructor(path: string) {
    super(
      `Response payload contains a raw Mongoose document or ObjectId at "${path}". ` +
        `Map it through an explicit serializer before returning it.`,
    )
    this.name = "RawDocumentError"
  }
}

export function assertNoRawDocuments(value: unknown, path = "root", seen = new WeakSet<object>()): void {
  if (value === null || typeof value !== "object") return
  if (seen.has(value as object)) return
  seen.add(value as object)

  if (value instanceof Date) return

  if (isMongooseLike(value)) {
    throw new RawDocumentError(path)
  }

  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertNoRawDocuments(entry, `${path}[${index}]`, seen))
    return
  }

  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    assertNoRawDocuments(entry, path === "root" ? key : `${path}.${key}`, seen)
  }
}

/* -------------------------------------------------------------------------- */
/* Dates                                                                       */
/* -------------------------------------------------------------------------- */

/** ISO 8601 with millisecond precision and a `Z` offset. */
export const IsoDateTimeSchema = z
  .string()
  .datetime({ offset: false })
  .describe("ISO 8601 UTC timestamp, e.g. 2026-01-31T09:15:00.000Z")

export function serializeDateTime(value: Date | string | number | null | undefined): string | null {
  if (value === null || typeof value === "undefined") return null

  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return null

  return date.toISOString()
}

/** Date-only serialization (`YYYY-MM-DD`) for calendar fields such as expiry. */
export function serializeDate(value: Date | string | number | null | undefined): string | null {
  const iso = serializeDateTime(value)
  return iso ? iso.slice(0, 10) : null
}

export const IsoDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .describe("ISO 8601 calendar date, e.g. 2026-01-31")

/* -------------------------------------------------------------------------- */
/* Money                                                                       */
/* -------------------------------------------------------------------------- */

/**
 * Canonical money representation. Amounts travel as integer minor units to keep
 * them exact; `amountMajor` is a convenience mirror for display and must never
 * be used for arithmetic by clients.
 */
export const MoneySchema = z
  .object({
    currency: z.string().length(3).describe("ISO 4217 currency code."),
    amountMinor: z.number().int().describe("Amount in minor units, e.g. kobo for NGN."),
    amountMajor: z.number().describe("Convenience mirror in major units. Display only."),
  })
  .describe("Monetary amount. Use amountMinor for any arithmetic.")

export type Money = z.infer<typeof MoneySchema>

const MINOR_UNIT_EXPONENT: Record<string, number> = {
  NGN: 2,
  USD: 2,
  EUR: 2,
  GBP: 2,
  KES: 2,
  GHS: 2,
  ZAR: 2,
  // Stellar lumens carry 7 decimal places on-ledger.
  XLM: 7,
}

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[currency.toUpperCase()] ?? 2
}

/** Builds a `Money` value from a major-unit amount (the app's storage form). */
export function money(amountMajor: number | null | undefined, currency = "NGN"): Money {
  const normalizedCurrency = currency.toUpperCase()
  const factor = 10 ** minorUnitExponent(normalizedCurrency)
  const safeMajor = Number.isFinite(amountMajor) ? (amountMajor as number) : 0
  const amountMinor = Math.round(safeMajor * factor)

  return {
    currency: normalizedCurrency,
    amountMinor,
    amountMajor: amountMinor / factor,
  }
}

/** Builds a `Money` value from an exact minor-unit amount. */
export function moneyFromMinor(amountMinor: number, currency = "NGN"): Money {
  const normalizedCurrency = currency.toUpperCase()
  const factor = 10 ** minorUnitExponent(normalizedCurrency)
  const safeMinor = Number.isFinite(amountMinor) ? Math.round(amountMinor) : 0

  return {
    currency: normalizedCurrency,
    amountMinor: safeMinor,
    amountMajor: safeMinor / factor,
  }
}

/* -------------------------------------------------------------------------- */
/* Identifiers                                                                 */
/* -------------------------------------------------------------------------- */

export const ObjectIdSchema = z
  .string()
  .regex(/^[a-f\d]{24}$/i)
  .describe("24-character hexadecimal identifier.")

/** Normalizes an ObjectId, string id, or populated document reference to a string. */
export function serializeId(value: unknown): string | null {
  if (!value) return null
  if (typeof value === "string") return value
  if (typeof value === "object") {
    const candidate = value as { _id?: unknown; toString?: () => string }
    if (candidate._id) return serializeId(candidate._id)
    if (typeof candidate.toString === "function") {
      const text = candidate.toString()
      return text === "[object Object]" ? null : text
    }
  }
  return null
}
