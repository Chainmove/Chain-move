import crypto from "crypto"

// Deterministic key-sorted JSON, same idiom as lib/stellar/pool-assets.ts and
// lib/security/audit-hash.ts, kept local so this module has no dependency on
// unrelated call sites.
export function canonicalize(value: unknown): string {
  if (value === null || value === undefined) return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalize(child)}`)
    return `{${entries.join(",")}}`
  }
  return JSON.stringify(value)
}

export function canonicalHash(value: unknown): string {
  return crypto.createHash("sha256").update(canonicalize(value)).digest("hex")
}
