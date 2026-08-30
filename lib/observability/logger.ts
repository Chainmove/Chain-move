export type LogLevel = "debug" | "info" | "warn" | "error"

const REDACTED = "[REDACTED]"
const SENSITIVE_KEY = /(?:authorization|cookie|api[_-]?key|token|secret|password|passcode|kyc|account(?:number)?|routing|provider.*payload|card|cvv|ssn|bvn|nin)/i
const MAX_DEPTH = 8

export interface LogContext {
  correlationId?: string
  operationId?: string
  event?: string
  [key: string]: unknown
}

/**
 * Redacts values by key at every nesting level before they leave process memory.
 * It deliberately preserves field names so operators can diagnose payload shape
 * without exposing the underlying financial or identity data.
 */
export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value == null || typeof value !== "object") return value
  if (depth >= MAX_DEPTH) return "[TRUNCATED]"
  if (seen.has(value as object)) return "[CIRCULAR]"
  seen.add(value as object)

  if (value instanceof Error) {
    return {
      name: value.name,
      message: SENSITIVE_KEY.test(value.message) ? REDACTED : value.message,
      ...(value.stack ? { stack: value.stack.split("\n").slice(0, 12).join("\n") } : {}),
      ...(value.cause !== undefined ? { cause: redact(value.cause, depth + 1, seen) } : {}),
    }
  }

  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1, seen))

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, item]) => [
      key,
      SENSITIVE_KEY.test(key) ? REDACTED : redact(item, depth + 1, seen),
    ]),
  )
}

function shouldLog(level: LogLevel) {
  const configured = process.env.LOG_LEVEL || (process.env.NODE_ENV === "production" ? "info" : "debug")
  return ["debug", "info", "warn", "error"].indexOf(level) >= ["debug", "info", "warn", "error"].indexOf(configured)
}

/** JSON-lines logger. Logging is best-effort: a broken log destination cannot interrupt payments. */
export function log(level: LogLevel, context: LogContext = {}) {
  if (!shouldLog(level)) return
  try {
    process.stdout.write(
      `${JSON.stringify({ timestamp: new Date().toISOString(), level, service: "chainmove-api", ...redact(context) })}\n`,
    )
  } catch {
    // Observability must never become an availability dependency.
  }
}

export const logger = {
  debug: (context: LogContext) => log("debug", context),
  info: (context: LogContext) => log("info", context),
  warn: (context: LogContext) => log("warn", context),
  error: (context: LogContext) => log("error", context),
}
