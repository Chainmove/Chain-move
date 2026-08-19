const encoder = new TextEncoder()

export function csvEscape(value: unknown): string {
  const raw = value == null ? "" : String(value)
  return raw.includes(",") || raw.includes("\"") || raw.includes("\n")
    ? `"${raw.replace(/"/g, "\"\"")}"`
    : raw
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
