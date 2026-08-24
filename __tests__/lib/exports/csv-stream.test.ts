import { describe, it, expect } from "vitest"
import { csvEscape, createCsvStream } from "@/lib/exports/csv-stream"

async function readStream(stream: ReadableStream<Uint8Array>): Promise<string> {
  // Response#text() decodes as UTF-8 and strips a leading BOM per the Encoding
  // spec, so BOM presence is verified separately from the raw bytes below.
  return new Response(stream).text()
}

async function readStreamBytes(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  return new Uint8Array(await new Response(stream).arrayBuffer())
}

async function* rowsOf(...rows: unknown[][]): AsyncGenerator<unknown[]> {
  for (const row of rows) yield row
}

describe("csvEscape", () => {
  describe("formula-injection neutralization", () => {
    const formulaPrefixes = [
      ["=", "=cmd|' /C calc'!A0"],
      ["+", "+1+1"],
      ["-", "-2+3+cmd|' /C calc'!A0"],
      ["@", "@SUM(A1:A2)"],
      ["full-width equals", "＝cmd()"],
      ["full-width plus", "＋1+1"],
      ["full-width minus", "－2+3"],
      ["full-width at", "＠SUM(1)"],
    ] as const

    it.each(formulaPrefixes)("neutralizes a leading %s payload", (_label, payload) => {
      expect(csvEscape(payload)).toBe(`'${payload}`)
    })

    it("does not flag a bare minus that is not a leading character", () => {
      expect(csvEscape("total-amount")).toBe("total-amount")
    })

    it("does not flag ordinary text", () => {
      expect(csvEscape("Ada Lovelace")).toBe("Ada Lovelace")
    })
  })

  describe("whitespace / control-character bypass attempts", () => {
    const bypasses = [
      ["leading space", " =cmd()"],
      ["leading tab", "\t=cmd()"],
      ["leading CR", "\r=cmd()"],
      ["leading LF", "\n=cmd()"],
      ["leading CRLF", "\r\n=cmd()"],
      ["multiple leading spaces", "   =cmd()"],
      ["leading null byte", "\x00=cmd()"],
      ["mixed whitespace/control", " \t\x00=cmd()"],
    ] as const

    it.each(bypasses)("still neutralizes %s", (_label, payload) => {
      const result = csvEscape(payload)
      // The escape must be applied at the true start of the value so the
      // whole cell is forced to text, regardless of what precedes the sigil.
      expect(result.startsWith("'") || result.startsWith(`"'`)).toBe(true)
    })

    it("treats a bare leading tab as dangerous on its own (OWASP direct trigger list)", () => {
      // A lone leading tab isn't itself an RFC 4180 quoting trigger, so the
      // neutralized value is emitted unquoted.
      const result = csvEscape("\thello")
      expect(result).toBe("'\thello")
    })

    it("treats a bare leading CR as dangerous on its own", () => {
      // The CR in the neutralized value now requires RFC 4180 quoting.
      const result = csvEscape("\rhello")
      expect(result).toBe(`"'\rhello"`)
    })

    it("does not neutralize plain leading whitespace with no trigger behind it", () => {
      expect(csvEscape("  hello")).toBe("  hello")
    })
  })

  describe("RFC 4180 quoting round-trip", () => {
    it("quotes and doubles embedded double quotes", () => {
      expect(csvEscape('She said "hi"')).toBe(`"She said ""hi"""`)
    })

    it("quotes fields containing a comma", () => {
      expect(csvEscape("Lagos, Nigeria")).toBe(`"Lagos, Nigeria"`)
    })

    it("quotes fields containing a bare CR", () => {
      expect(csvEscape("line1\rline2")).toBe(`"line1\rline2"`)
    })

    it("quotes fields containing a bare LF", () => {
      expect(csvEscape("line1\nline2")).toBe(`"line1\nline2"`)
    })

    it("quotes fields containing CRLF", () => {
      expect(csvEscape("line1\r\nline2")).toBe(`"line1\r\nline2"`)
    })

    it("round-trips Unicode content untouched", () => {
      expect(csvEscape("Adaeze Okafor — 驾驶员 — Ω")).toBe("Adaeze Okafor — 驾驶员 — Ω")
    })

    it("combines neutralization with quoting when both apply", () => {
      expect(csvEscape("=cmd(),pwned")).toBe(`"'=cmd(),pwned"`)
    })

    it("leaves an already-safe quoted-looking value alone when no trigger is present", () => {
      expect(csvEscape("plain, text")).toBe(`"plain, text"`)
    })
  })

  describe("trusted primitive passthrough", () => {
    it("preserves positive numbers", () => {
      expect(csvEscape(45000)).toBe("45000")
    })

    it("preserves negative numbers without adding a neutralizing prefix", () => {
      expect(csvEscape(-500)).toBe("-500")
    })

    it("preserves decimals", () => {
      expect(csvEscape(12.5)).toBe("12.5")
    })

    it("preserves booleans", () => {
      expect(csvEscape(true)).toBe("true")
      expect(csvEscape(false)).toBe("false")
    })

    it("preserves bigint", () => {
      expect(csvEscape(BigInt("9007199254740993"))).toBe("9007199254740993")
    })

    it("preserves Date values as ISO strings", () => {
      const date = new Date("2026-01-31T09:15:00.000Z")
      expect(csvEscape(date)).toBe("2026-01-31T09:15:00.000Z")
    })

    it("renders null and undefined as an empty cell", () => {
      expect(csvEscape(null)).toBe("")
      expect(csvEscape(undefined)).toBe("")
    })
  })
})

describe("createCsvStream", () => {
  it("prefixes a UTF-8 BOM and neutralizes a malicious cell end to end", async () => {
    const build = () =>
      createCsvStream(["Name", "Note"], rowsOf(["Ada Lovelace", "=HYPERLINK(\"http://evil.example\")"], [123, -50]))

    const bytes = await readStreamBytes(build())
    expect(Array.from(bytes.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf])

    const text = await readStream(build())
    expect(text).toContain(`"'=HYPERLINK(""http://evil.example"")"`)
    expect(text).toContain("123,-50")
  })

  it("closes cleanly with no rows", async () => {
    const stream = createCsvStream(["A", "B"], rowsOf())
    const text = await readStream(stream)
    expect(text).toBe("A,B\n")
  })
})
