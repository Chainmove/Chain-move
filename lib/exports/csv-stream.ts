const encoder = new TextEncoder()

// OWASP CSV Injection: https://owasp.org/www-community/attacks/CSV_Injection
// lists these ASCII/full-width sigils as formula starters, plus Tab/CR/LF as
// dangerous leading characters in their own right (legacy DDE-launch vector).
const FORMULA_SIGILS = new Set(["=", "+", "-", "@", "＝", "＋", "－", "＠"])
const DIRECT_TRIGGER_CHARS = new Set<string>([...FORMULA_SIGILS, "\t", "\r", "\n"])
// Some spreadsheet parsers trim ordinary leading whitespace/control bytes
// before evaluating a formula sigil, so a payload can hide behind them
// (e.g. " =cmd(...)"). Re-check the first character that survives a strip.
const LEADING_WHITESPACE_OR_CONTROL = /^[\s\x00-\x1F\x7F]+/
const NEEDS_QUOTING = /["\r\n,]/

function startsWithFormulaTrigger(raw: string): boolean {
  if (raw.length === 0) return false
  if (DIRECT_TRIGGER_CHARS.has(raw[0])) return true
  const visible = raw.replace(LEADING_WHITESPACE_OR_CONTROL, "")
  return visible.length > 0 && FORMULA_SIGILS.has(visible[0])
}

/**
 * Encodes a single CSV cell: RFC 4180 quoting plus formula-injection
 * neutralization (OWASP CSV Injection). Trusted primitives (number, boolean,
 * bigint, Date) are stringified as-is — only string content, the only place
 * user-controlled text reaches an export, is checked for a formula trigger —
 * so ordinary numeric and date values are never altered.
 *
 * A detected trigger is neutralized by prepending a single quote, the same
 * "treat as text" convention Excel, Google Sheets, and LibreOffice Calc use
 * on import; combined with quoting/doubling for embedded quotes, commas, and
 * newlines, this applies all three sanitization techniques OWASP lists.
 *
 * O(n) in the length of the cell value; at most one extra string copy for
 * the sigil prefix and one for quote-doubling, both inherent to the encoding.
 */
export function csvEscape(value: unknown): string {
  if (value == null) return ""
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
    return String(value)
  }
  const raw = value instanceof Date ? value.toISOString() : String(value)
  const neutralized = startsWithFormulaTrigger(raw) ? `'${raw}` : raw
  return NEEDS_QUOTING.test(neutralized) ? `"${neutralized.replace(/"/g, "\"\"")}"` : neutralized
}

/**
 * Converts an async row source to a response body. The stream only requests the
 * next row when the consumer is ready, so database cursors remain bounded by
 * their configured batch size instead of the size of the export.
 */
export function createCsvStream(headers: string[], rows: AsyncIterable<unknown[]>): ReadableStream<Uint8Array> {
  const iterator = rows[Symbol.asyncIterator]()
  let wroteHeader = false

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        if (!wroteHeader) {
          wroteHeader = true
          controller.enqueue(encoder.encode(`\uFEFF${headers.map(csvEscape).join(",")}\n`))
          return
        }

        const next = await iterator.next()
        if (next.done) {
          controller.close()
          return
        }
        controller.enqueue(encoder.encode(`${next.value.map(csvEscape).join(",")}\n`))
      } catch (error) {
        await iterator.return?.()
        controller.error(error)
      }
    },
    async cancel() {
      await iterator.return?.()
    },
  })
}
